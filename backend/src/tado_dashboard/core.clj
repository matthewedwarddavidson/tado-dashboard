(ns tado-dashboard.core
  "Entry point for the tado data analyser backend."
  (:require [tado-dashboard.auth :as auth]
            [tado-dashboard.config :as config]
            [tado-dashboard.server :as server]
            [taoensso.timbre :as log])
  (:gen-class))

(defonce server-instance (atom nil))

(defn start!
  "Attempts to restore auth from disk (non-blocking), then starts the HTTP server.
   If no stored token exists, browser-based auth is used on first access."
  []
  (let [{:keys [server]} (config/load-config)
        port (or (:port server) 3000)]
    (log/info "Starting tado data analyser")
    (auth/try-restore-from-disk!)
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
