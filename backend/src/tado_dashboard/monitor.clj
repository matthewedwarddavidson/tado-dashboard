(ns tado-dashboard.monitor
  "Background polling loop that detects inside/outside temperature crossings
   and sends notifications via tado-dashboard.notifier."
  (:require [tado-dashboard.api :as tado]
            [tado-dashboard.notifier :as notifier]
            [taoensso.timbre :as log]))

;; Per-zone crossing state: {:zone-id {:state :outside-warmer | :inside-warmer | :unknown}}
(defonce ^:private zone-states (atom {}))
(defonce ^:private running? (atom false))
(defonce ^:private monitor-thread (atom nil))

(defn- initial-state
  "Derives a baseline crossing state from raw temperatures without hysteresis.
   Used only on first poll to avoid spurious startup notifications."
  [inside outside]
  (if (>= outside inside) :outside-warmer :inside-warmer))

(defn- next-state
  "Returns the new crossing state given the previous state and current temperatures,
   applying `hysteresis` to avoid flapping near the crossover point."
  [prev inside outside hysteresis]
  (cond
    (>= (- outside inside) hysteresis) :outside-warmer
    (>= (- inside outside) hysteresis) :inside-warmer
    :else prev))

(defn- check-zone!
  "Checks a single zone for a temperature crossing and sends a notification if
   the state has changed since the last poll."
  [zone inside outside topic hysteresis]
  (let [zone-id   (:id zone)
        zone-name (:name zone)
        prev      (get-in @zone-states [zone-id :state] :unknown)]
    (if (= prev :unknown)
      (do
        (log/infof "Monitor baseline — %s: inside=%.1f°C outside=%.1f°C"
                   zone-name inside outside)
        (swap! zone-states assoc-in [zone-id :state] (initial-state inside outside)))
      (let [new-state (next-state prev inside outside hysteresis)]
        (when (not= new-state prev)
          (let [[title body]
                (if (= new-state :outside-warmer)
                  [(str "🌡️ Close windows — " zone-name)
                   (format "Outside (%.1f°C) is now warmer than inside (%.1f°C)"
                           outside inside)]
                  [(str "🪟 Open windows — " zone-name)
                   (format "Inside (%.1f°C) is now warmer than outside (%.1f°C)"
                           inside outside)])]
            (log/infof "Temperature crossing in %s: %s → %s" zone-name prev new-state)
            (notifier/send-notification topic title body)))
        (swap! zone-states assoc-in [zone-id :state] new-state)))))

(defn- poll!
  "Fetches current outside temperature and checks all heating zones for crossings."
  [home-id topic hysteresis]
  (let [outside (-> (tado/get-weather home-id) :outsideTemperature :celsius)
        zones   (->> (tado/get-zones home-id)
                     (filter #(= "HEATING" (:type %))))]
    (doseq [zone zones]
      (try
        (let [inside (-> (tado/get-zone-state home-id (:id zone))
                         :sensorDataPoints
                         :insideTemperature
                         :celsius)]
          (when inside
            (check-zone! zone inside outside topic hysteresis)))
        (catch Exception e
          (log/errorf e "Error checking zone %s" (:name zone)))))))

(defn- resolve-home-id
  "Returns the first home-id for the authenticated user, or nil if not yet authenticated."
  []
  (-> (tado/get-me) :homes first :id))

(defn- poll-loop
  "Runs the polling loop until `running?` is false."
  [topic interval-ms hysteresis]
  (log/info "Temperature monitor started")
  (loop [home-id nil]
    (when @running?
      (let [hid (or home-id
                    (try
                      (resolve-home-id)
                      (catch Exception _
                        (log/warn "Monitor: not yet authenticated, will retry next poll")
                        nil)))]
        (when hid
          (try
            (poll! hid topic hysteresis)
            (catch Exception e
              (log/errorf e "Error in temperature monitor poll"))))
        (try
          (Thread/sleep interval-ms)
          (catch InterruptedException _
            (reset! running? false)))
        (when @running?
          (recur hid)))))
  (log/info "Temperature monitor stopped"))

(defn start!
  "Starts the background temperature monitor.
   `config` is a map with keys `:interval-secs`, `:hysteresis-c`, and `:ntfy`
   (a map containing `:topic`)."
  [{:keys [interval-secs hysteresis-c topic]
    :or   {interval-secs 300 hysteresis-c 0.5}}]
  (reset! running? true)
  (reset! zone-states {})
  (let [t (Thread. ^Runnable #(poll-loop topic (* interval-secs 1000) hysteresis-c))]
    (.setDaemon t true)
    (.setName t "tado-monitor")
    (.start t)
    (reset! monitor-thread t)))

(defn stop!
  "Stops the background temperature monitor."
  []
  (reset! running? false)
  (when-let [t @monitor-thread]
    (.interrupt t)))
