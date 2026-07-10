(ns tado-data-analyser.auth
  "Manages OAuth2 device-code-flow token lifecycle for the tado API.
   On first run, prints a URL for the user to authorize the app.
   The resulting refresh token is persisted locally to avoid re-authorization
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

(defn- start-device-flow!
  "Initiates the device authorization flow, returning the authorization response body."
  []
  (-> (http/post device-auth-url
                 {:query-params {:client_id client-id
                                 :scope     scope}
                  :as           :json})
      :body))

(defn- poll-for-token
  "Polls the token endpoint until the user completes authorization.
   Blocks the calling thread."
  [device-code interval-secs]
  (loop []
    (Thread/sleep (* interval-secs 1000))
    (let [resp (http/post token-url
                          {:query-params     {:client_id   client-id
                                             :device_code device-code
                                             :grant_type  device-code-grant}
                           :as               :json
                           :throw-exceptions false})]
      (if (= 200 (:status resp))
        (parse-token-response (:body resp))
        (do
          (log/info "Waiting for device authorization...")
          (recur))))))

(defn- authenticate-via-device-flow!
  "Runs the full device authorization flow, blocking until the user approves.
   Persists the resulting refresh token to disk."
  []
  (let [{:keys [verification_uri user_code device_code interval]} (start-device-flow!)
        interval-secs (or interval 5)
        visit-url     (str verification_uri
                           "?user_code=" user_code
                           "&client_id=" client-id)]
    (println)
    (println "=== tado° Authorization Required ===")
    (println (str "1. Open:  " visit-url))
    (println (str "2. Code:  " user_code))
    (println "Waiting for authorization (check your browser)...")
    (println)
    (let [new-state (poll-for-token device_code interval-secs)]
      (save-refresh-token! (:refresh-token new-state))
      (reset! token-state new-state)
      (log/info "tado authorization successful"))))

(defn ensure-authenticated!
  "Ensures a valid token is present in token-state.
   On first run, initiates the device authorization flow and blocks until complete.
   On subsequent runs, attempts to reuse the stored refresh token."
  []
  (let [refresh-token (or (some-> @token-state :refresh-token)
                          (load-refresh-token))]
    (if refresh-token
      (try
        (let [new-state (fetch-token-with-refresh refresh-token)]
          (reset! token-state new-state)
          (log/info "tado authentication successful"))
        (catch Exception e
          (log/warn "Stored refresh token is invalid, re-authorizing:" (.getMessage e))
          (authenticate-via-device-flow!)))
      (do
        (log/info "No stored token found, starting device authorization flow")
        (authenticate-via-device-flow!)))))

(defn get-access-token
  "Returns a valid access token, refreshing it silently if expired."
  []
  (let [state @token-state]
    (if (or (nil? state) (.isAfter (Instant/now) (:expires-at state)))
      (let [new-state (fetch-token-with-refresh (:refresh-token state))]
        (reset! token-state new-state)
        (:access-token new-state))
      (:access-token state))))
