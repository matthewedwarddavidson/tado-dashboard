(ns tado-data-analyser.api
  "Client for the tado API v2. Uses the global token from tado-data-analyser.auth."
  (:require [clj-http.client :as http]
            [tado-data-analyser.auth :as auth]))

(def base-url "https://my.tado.com/api/v2")

(defn- auth-headers
  "Builds the Authorization header map using the current access token."
  []
  {"Authorization" (str "Bearer " (auth/get-access-token))})

(defn- api-get
  "Makes an authenticated GET request to the tado API and returns the parsed body."
  ([path]
   (api-get path {}))
  ([path query-params]
   (-> (http/get (str base-url path)
                 {:headers      (auth-headers)
                  :query-params  query-params
                  :as           :json})
       :body)))

(defn get-me
  "Returns the currently authenticated user, including their list of homes."
  []
  (api-get "/me"))

(defn get-home
  "Returns details for the given `home-id`."
  [home-id]
  (api-get (str "/homes/" home-id)))

(defn get-home-state
  "Returns the presence state (HOME/AWAY) for the given `home-id`."
  [home-id]
  (api-get (str "/homes/" home-id "/state")))

(defn get-zones
  "Returns the list of zones (rooms) for the given `home-id`."
  [home-id]
  (api-get (str "/homes/" home-id "/zones")))

(defn get-zone-state
  "Returns the current state of a zone: temperature, humidity, heating power, etc."
  [home-id zone-id]
  (api-get (str "/homes/" home-id "/zones/" zone-id "/state")))

(defn get-zone-day-report
  "Returns the historical data report for `zone-id` on the given `date` (YYYY-MM-DD string).
   Includes time-series data for temperature, humidity, heating, and set-point."
  [home-id zone-id date]
  (api-get (str "/homes/" home-id "/zones/" zone-id "/dayReport")
           {:date date}))

(defn get-weather
  "Returns the current weather report for the home's location."
  [home-id]
  (api-get (str "/homes/" home-id "/weather")))
