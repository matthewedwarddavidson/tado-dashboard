(ns tado-data-analyser.core
  "Entry point for the tado data analyser backend."
  (:require [tado-data-analyser.auth :as auth]
            [tado-data-analyser.config :as config]
            [tado-data-analyser.server :as server]
            [taoensso.timbre :as log])
  (:gen-class))

(defonce server-instance (atom nil))

(defn start!
  "Authenticates with tado (device flow if first run) then starts the HTTP server."
  []
  (let [{:keys [server]} (config/load-config)
        port (or (:port server) 3000)]
    (log/info "Starting tado data analyser")
    (auth/ensure-authenticated!)
    (reset! server-instance (server/start! port))))

(defn stop!
  "Stops the running server if one is active."
  []
  (when-let [s @server-instance]
    (server/stop! s)
    (reset! server-instance nil)))

(defn -main
  "Application entry point."
  [& _args]
  (.addShutdownHook
   (Runtime/getRuntime)
   (Thread. ^Runnable #(stop!)))
  (start!))
