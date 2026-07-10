(ns tado-data-analyser.server
  "Ring HTTP server with reitit routing, serving the tado API proxy."
  (:require [reitit.ring :as reitit]
            [ring.adapter.jetty :as jetty]
            [ring.middleware.json :refer [wrap-json-response]]
            [ring.middleware.params :refer [wrap-params]]
            [ring.util.response :as response]
            [ring.middleware.cors :refer [wrap-cors]]
            [tado-data-analyser.api :as tado]
            [taoensso.timbre :as log]))

(defn- wrap-exception
  "Catches unhandled exceptions and returns a JSON error response."
  [handler]
  (fn [req]
    (try
      (handler req)
      (catch Exception e
        (log/error e "Unhandled error handling request" (:uri req))
        {:status 500
         :body   {:error (.getMessage e)}}))))

(def routes
  ["/api"
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

(defn make-app
  "Assembles the Ring application stack."
  []
  (-> (reitit/ring-handler
       (reitit/router routes)
       (reitit/create-default-handler
        {:not-found (constantly (response/not-found {:error "Not found"}))}))
      (wrap-exception)
      (wrap-json-response)
      (wrap-params)
      (wrap-cors :access-control-allow-origin  [#".*"]
                 :access-control-allow-methods [:get :options]
                 :access-control-allow-headers ["Content-Type" "Authorization"])))

(defn start!
  "Starts the Jetty HTTP server on `port`. Returns the server instance."
  [port]
  (log/infof "Starting tado API server on port %d" port)
  (jetty/run-jetty (make-app) {:port port :join? false}))

(defn stop!
  "Stops the given Jetty `server` instance."
  [server]
  (log/info "Stopping server")
  (.stop server))
