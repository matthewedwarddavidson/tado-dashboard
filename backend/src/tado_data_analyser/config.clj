(ns tado-data-analyser.config
  "Loads application configuration from config.edn, with environment variable overrides."
  (:require [aero.core :as aero]
            [clojure.java.io :as io]))

(defn load-config
  "Reads config from `resources/config.edn`. Returns the config map."
  []
  (-> "config.edn"
      io/resource
      (aero/read-config)))
