(ns tado-dashboard.core
  "Entry point for the tado data analyser backend."
  (:require [tado-dashboard.auth :as auth]
            [tado-dashboard.config :as config]
            [tado-dashboard.monitor :as monitor]
            [tado-dashboard.notifier :as notifier]
            [tado-dashboard.server :as server]
            [taoensso.timbre :as log])
  (:gen-class))

(defonce server-instance (atom nil))

(defn start!
  "Attempts to restore auth from disk (non-blocking), then starts the HTTP server.
   If no stored token exists, browser-based auth is used on first access.
   Also starts the temperature crossing monitor if NTFY_TOPIC is configured."
  []
  (let [{:keys [server monitor]} (config/load-config)
        port (or (:port server) 3000)]
    (log/info "Starting tado data analyser")
    (auth/try-restore-from-disk!)
    (reset! server-instance (server/start! port))
    (if (:enabled monitor true)
      (let [topic (notifier/resolve-topic!)]
        (log/infof "Temperature monitor enabled — subscribe to ntfy.sh topic: %s" topic)
        (monitor/start! (assoc monitor :topic topic)))
      (log/info "Temperature monitor disabled"))))

(defn stop!
  "Stops the monitor and the HTTP server."
  []
  (monitor/stop!)
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
