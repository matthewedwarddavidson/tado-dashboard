(ns tado-dashboard.api
  "Client for the tado API v2. Uses the global token from tado-dashboard.auth."
  (:require [clj-http.client :as http]
            [tado-dashboard.auth :as auth])
  (:import [java.time LocalDate]
           [java.time.temporal ChronoUnit]))

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

(def ^:private open-meteo-forecast-url "https://api.open-meteo.com/v1/forecast")
(def ^:private open-meteo-archive-url  "https://archive-api.open-meteo.com/v1/archive")

(def ^:private wmo-descriptions
  "Maps WMO weather interpretation codes to human-readable state strings."
  {0  "CLEAR_SKY"
   1  "MAINLY_CLEAR"           2  "PARTLY_CLOUDY"              3  "OVERCAST"
   45 "FOG"                    48 "RIME_FOG"
   51 "LIGHT_DRIZZLE"          53 "MODERATE_DRIZZLE"           55 "DENSE_DRIZZLE"
   61 "SLIGHT_RAIN"            63 "MODERATE_RAIN"              65 "HEAVY_RAIN"
   71 "SLIGHT_SNOW"            73 "MODERATE_SNOW"              75 "HEAVY_SNOW"
   80 "SLIGHT_SHOWERS"         81 "MODERATE_SHOWERS"           82 "HEAVY_SHOWERS"
   95 "THUNDERSTORM"           96 "THUNDERSTORM_WITH_HAIL"     99 "THUNDERSTORM_HEAVY_HAIL"})

;; Cache home geolocation so we don't fetch it on every weather poll.
(def ^:private home-locations (atom {}))

(defn- fetch-home-location
  "Returns the geolocation map for `home-id`, fetching and caching it on first call."
  [home-id]
  (or (get @home-locations home-id)
      (let [loc (-> (get-home home-id) :geolocation)]
        (swap! home-locations assoc home-id loc)
        loc)))

(defn- celsius->fahrenheit [c] (+ (* c (/ 9.0 5.0)) 32.0))

(defn get-outside-weather
  "Returns hourly outside temperature and humidity data from Open-Meteo for the
   given date range. `from-date` and `to-date` are YYYY-MM-DD strings. Uses the
   archive API for ranges older than 7 days, the forecast API otherwise.
   Returns {:temperature [{:timestamp iso-string :value {:celsius n}}]
            :humidity    [{:timestamp iso-string :value n}]}."
  [home-id from-date to-date]
  (let [{:keys [latitude longitude]} (fetch-home-location home-id)]
    (when (and latitude longitude)
      (let [from-ld   (LocalDate/parse from-date)
            days-back (.between ChronoUnit/DAYS from-ld (LocalDate/now))
            url       (if (> days-back 7) open-meteo-archive-url open-meteo-forecast-url)
            hourly    (-> (http/get url
                                    {:query-params {:latitude         latitude
                                                    :longitude        longitude
                                                    :hourly           "temperature_2m,relative_humidity_2m"
                                                    :start_date       from-date
                                                    :end_date         to-date
                                                    :timezone         "UTC"
                                                    :temperature_unit "celsius"}
                                     :as           :json})
                          :body
                          :hourly)
            times     (:time hourly)
            temps     (:temperature_2m hourly)
            humids    (:relative_humidity_2m hourly)]
        {:temperature (map (fn [ts celsius]
                             {:timestamp (str ts ":00Z")
                              :value     {:celsius    celsius
                                          :fahrenheit (celsius->fahrenheit celsius)}})
                           times temps)
         :humidity    (map (fn [ts h]
                             {:timestamp (str ts ":00Z")
                              :value     (double h)})
                           times humids)}))))

(defn get-weather
  "Returns the current weather at the home's location using Open-Meteo
   (https://open-meteo.com), cross-referenced against the home's geolocation
   from tado. Falls back to the tado weather endpoint if no geolocation is
   available."
  [home-id]
  (let [{:keys [latitude longitude]} (fetch-home-location home-id)]
    (if (and latitude longitude)
      (let [current (-> (http/get open-meteo-forecast-url
                                  {:query-params {:latitude         latitude
                                                  :longitude        longitude
                                                  :current          "temperature_2m,relative_humidity_2m,weather_code,cloud_cover"
                                                  :temperature_unit "celsius"}
                                   :as           :json})
                        :body
                        :current)
            celsius (:temperature_2m current)
            ts      (:time current)]
        {:outsideTemperature {:celsius    celsius
                              :fahrenheit (celsius->fahrenheit celsius)
                              :timestamp  ts}
         :relativeHumidity   {:percentage (double (or (:relative_humidity_2m current) 0))
                              :timestamp  ts}
         :weatherState       {:value     (get wmo-descriptions (:weather_code current) "UNKNOWN")
                              :timestamp  ts}})
      (api-get (str "/homes/" home-id "/weather")))))
