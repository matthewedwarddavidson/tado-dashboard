(ns tado-dashboard.server
  "Ring HTTP server with reitit routing, static file serving, and browser-based auth."
  (:require [clojure.string :as str]
            [reitit.ring :as reitit]
            [ring.adapter.jetty :as jetty]
            [ring.middleware.content-type :refer [wrap-content-type]]
            [ring.middleware.cors :refer [wrap-cors]]
            [ring.middleware.json :refer [wrap-json-response]]
            [ring.middleware.params :refer [wrap-params]]
            [ring.middleware.resource :refer [wrap-resource]]
            [ring.util.response :as response]
            [tado-dashboard.api :as tado]
            [tado-dashboard.auth :as auth]
            [taoensso.timbre :as log]))

(defn- wrap-exception
  "Catches unhandled exceptions and returns a JSON 500 response."
  [handler]
  (fn [req]
    (try
      (handler req)
      (catch Exception e
        (log/error e "Unhandled error handling request" (:uri req))
        {:status 500
         :body   {:error (.getMessage e)}}))))

(defn- wrap-auth-required
  "Returns 401 for /api/* requests (except /api/auth/) when not authenticated."
  [handler]
  (fn [req]
    (let [uri (:uri req)]
      (if (and (str/starts-with? uri "/api/")
               (not (str/starts-with? uri "/api/auth/"))
               (not= :authenticated (auth/get-auth-status)))
        {:status 401
         :body   {:error "Not authenticated"}}
        (handler req)))))

(defn- auth-status-response
  "Builds the auth status response map."
  []
  (let [status  (auth/get-auth-status)
        pending @auth/pending-flow]
    (cond-> {:status (name status)}
      (= status :pending)
      (merge {:verificationUri (:verification-uri pending)
              :userCode        (:user-code pending)
              :expiresIn       (:expires-in pending)}))))

(def ^:private routes
  ["/api"
   ["/auth"
    ["/status"
     {:get {:handler (fn [_] (response/response (auth-status-response)))}}]

    ["/start"
     {:post {:handler (fn [_]
               (let [status (auth/get-auth-status)]
                 (cond
                   (= status :authenticated)
                   (response/response {:status "authenticated"})

                   (= status :pending)
                   (response/response (auth-status-response))

                   :else
                   (let [flow (auth/start-device-flow-and-poll!)]
                     (response/response {:status          "pending"
                                         :verificationUri (:verification-uri flow)
                                         :userCode        (:user-code flow)
                                         :expiresIn       (:expires-in flow)})))))}}]]

   ["/me"
    {:get {:handler (fn [_] (response/response (tado/get-me)))}}]

   ["/homes/:home-id"
    [""
     {:get {:handler (fn [req]
                       (-> req :path-params :home-id tado/get-home response/response))}}]

    ["/state"
     {:get {:handler (fn [req]
                       (-> req :path-params :home-id tado/get-home-state response/response))}}]

    ["/zones"
     {:get {:handler (fn [req]
                       (-> req :path-params :home-id tado/get-zones response/response))}}]

    ["/zones/:zone-id"
     ["/state"
      {:get {:handler (fn [req]
                        (let [{:keys [home-id zone-id]} (:path-params req)]
                          (-> (tado/get-zone-state home-id zone-id)
                              response/response)))}}]

     ["/day-report"
      {:get {:handler (fn [req]
                        (let [{:keys [home-id zone-id]} (:path-params req)
                              date (-> req :query-params (get "date"))]
                          (if date
                            (-> (tado/get-zone-day-report home-id zone-id date)
                                response/response)
                            (response/bad-request {:error "date query parameter is required"}))))}}]]

    ["/weather"
     {:get {:handler (fn [req]
                       (-> req :path-params :home-id tado/get-weather response/response))}}]]])

(defn- spa-fallback
  "Serves the SPA index.html for any non-API route, enabling client-side routing."
  [req]
  (if (str/starts-with? (:uri req) "/api")
    (response/not-found {:error "Not found"})
    (-> (response/resource-response "index.html" {:root "public"})
        (response/content-type "text/html; charset=utf-8"))))

(defn make-app
  "Assembles the Ring application stack."
  []
  (-> (reitit/ring-handler
       (reitit/router routes)
       (reitit/create-default-handler {:not-found spa-fallback}))
      wrap-auth-required
      wrap-exception
      wrap-json-response
      wrap-params
      (wrap-resource "public")
      wrap-content-type
      (wrap-cors :access-control-allow-origin  [#".*"]
                 :access-control-allow-methods [:get :post :options]
                 :access-control-allow-headers ["Content-Type" "Authorization"])))

(defn start!
  "Starts the Jetty HTTP server on `port`. Returns the server instance."
  [port]
  (log/infof "Starting tado API server on port %d" port)
  (jetty/run-jetty (make-app) {:port port :join? false}))

(defn stop!
  "Stops the given Jetty server instance."
  [server]
  (log/info "Stopping server")
  (.stop server))
