(ns tado-dashboard.auth
  "Manages OAuth2 device-code-flow token lifecycle for the tado API.
   On first run the user is prompted to authorise the app via the browser.
   The resulting refresh token is persisted locally to avoid re-authorisation
   on subsequent restarts."
  (:require [clj-http.client :as http]
            [clojure.edn :as edn]
            [clojure.java.io :as io]
            [taoensso.timbre :as log])
  (:import [java.time Instant]))

(def client-id "1bb50063-6b0c-4d11-bd99-387f4a91cc46")
(def scope "offline_access")
(def token-file ".tado-token.edn")

(def ^:private device-auth-url "https://login.tado.com/oauth2/device_authorize")
(def ^:private token-url "https://login.tado.com/oauth2/token")
(def ^:private device-code-grant "urn:ietf:params:oauth:grant-type:device_code")

;; Holds {:access-token "...", :refresh-token "...", :expires-at #inst "..."}
(def token-state (atom nil))

;; Current authentication status: :unauthenticated | :pending | :authenticated
(def auth-status (atom :unauthenticated))

;; Device flow info shared with the server while auth is in progress
;; {:verification-uri "..." :user-code "..." :device-code "..." :expires-in 300}
(def pending-flow (atom nil))

(defn- expires-at
  "Calculates the token expiry Instant, with a 30-second safety margin."
  [expires-in-seconds]
  (-> (Instant/now) (.plusSeconds (- expires-in-seconds 30))))

(defn- parse-token-response
  "Extracts relevant fields from an OAuth token response body."
  [{:keys [access_token refresh_token expires_in]}]
  {:access-token  access_token
   :refresh-token refresh_token
   :expires-at    (expires-at expires_in)})

(defn- save-refresh-token!
  "Persists the refresh token to the local token file."
  [refresh-token]
  (spit token-file (pr-str {:refresh-token refresh-token})))

(defn- load-refresh-token
  "Loads a previously stored refresh token from the local token file.
   Returns nil if no token file exists."
  []
  (when (.exists (io/file token-file))
    (-> token-file slurp edn/read-string :refresh-token)))

(defn- fetch-token-with-refresh
  "Exchanges a refresh token for a new access token."
  [refresh-token]
  (log/info "Refreshing tado access token")
  (-> (http/post token-url
                 {:query-params {:grant_type    "refresh_token"
                                 :client_id     client-id
                                 :refresh_token refresh-token}
                  :as           :json})
      :body
      parse-token-response))

(defn- invalid-grant?
  "Returns true if the exception is a tado invalid_grant (revoked/expired refresh token)."
  [e]
  (and (instance? clojure.lang.ExceptionInfo e)
       (= 400 (-> e ex-data :status))
       (some-> e ex-data :body str (.contains "invalid_grant"))))

(defn- clear-stored-token!
  "Removes the in-memory token state, the token file, and sets status to unauthenticated."
  []
  (reset! token-state nil)
  (reset! auth-status :unauthenticated)
  (io/delete-file token-file true))

(defn- start-device-flow!
  "Initiates the device authorisation flow, returning the authorisation response body."
  []
  (-> (http/post device-auth-url
                 {:query-params {:client_id client-id
                                 :scope     scope}
                  :as           :json})
      :body))

(defn- poll-for-token
  "Polls the token endpoint until the user completes authorization.
   Blocks the calling thread. Throws on expiry or denial."
  [device-code interval-secs]
  (loop []
    (Thread/sleep (* interval-secs 1000))
    (let [resp (http/post token-url
                          {:query-params     {:client_id   client-id
                                             :device_code device-code
                                             :grant_type  device-code-grant}
                           :as               :json
                           :throw-exceptions false})]
      (cond
        (= 200 (:status resp))
        (parse-token-response (:body resp))

        (= "expired_token" (-> resp :body :error))
        (throw (ex-info "Device code expired" {:error :expired}))

        (= "access_denied" (-> resp :body :error))
        (throw (ex-info "Authorization denied" {:error :denied}))

        :else
        (do
          (log/debug "Waiting for device authorization...")
          (recur))))))

(defn get-auth-status
  "Returns the current authentication status keyword."
  []
  @auth-status)

(defn try-restore-from-disk!
  "Attempts to restore authentication from a stored refresh token.
   Non-blocking: sets auth-status to :authenticated or :unauthenticated.
   Deletes the token file if the stored token has been revoked."
  []
  (when-let [refresh-token (or (some-> @token-state :refresh-token)
                               (load-refresh-token))]
    (try
      (let [new-state (fetch-token-with-refresh refresh-token)]
        (reset! token-state new-state)
        (reset! auth-status :authenticated)
        (log/info "Restored tado authentication from stored token"))
      (catch Exception e
        (if (invalid-grant? e)
          (do (log/warn "Stored refresh token has been revoked — re-authentication required")
              (clear-stored-token!))
          (do (log/warn "Stored token invalid, browser auth required:" (.getMessage e))
              (reset! auth-status :unauthenticated)))))))

(defn start-device-flow-and-poll!
  "Initiates the device authorisation flow and polls in a background thread.
   Returns the pending flow map immediately for display in the browser."
  []
  (let [{:keys [verification_uri user_code device_code interval expires_in]} (start-device-flow!)
        interval-secs (or interval 5)
        ;; tado's verification_uri is bare — client_id and user_code must be appended
        full-uri      (str verification_uri "?user_code=" user_code "&client_id=" client-id)
        flow {:verification-uri full-uri
              :user-code        user_code
              :device-code      device_code
              :expires-in       expires_in}]
    (reset! auth-status :pending)
    (reset! pending-flow flow)
    (future
      (try
        (let [new-state (poll-for-token device_code interval-secs)]
          (save-refresh-token! (:refresh-token new-state))
          (reset! token-state new-state)
          (reset! pending-flow nil)
          (reset! auth-status :authenticated)
          (log/info "tado browser authorization successful"))
        (catch Exception e
          (log/error "Device flow failed:" (.getMessage e))
          (reset! pending-flow nil)
          (reset! auth-status :unauthenticated))))
    flow))

(defn get-access-token
  "Returns a valid access token, refreshing it silently if expired.
   If the refresh token has been revoked, clears stored credentials and
   throws so the caller receives a 401."
  []
  (let [state @token-state]
    (if (or (nil? state) (.isAfter (Instant/now) (:expires-at state)))
      (try
        (let [new-state (fetch-token-with-refresh (:refresh-token state))]
          (reset! token-state new-state)
          (:access-token new-state))
        (catch Exception e
          (when (invalid-grant? e)
            (log/warn "Refresh token revoked — clearing credentials, re-authentication required")
            (clear-stored-token!))
          (throw e)))
      (:access-token state))))
