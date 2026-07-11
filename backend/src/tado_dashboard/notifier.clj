(ns tado-dashboard.notifier
  "Sends push notifications via ntfy.sh.
   The ntfy.sh topic is auto-generated as a UUID on first run and persisted to disk."
  (:require [clj-http.client :as http]
            [clojure.edn :as edn]
            [clojure.java.io :as io]
            [taoensso.timbre :as log]))

(def ^:private topic-file ".tado-ntfy.edn")

(defn resolve-topic!
  "Returns the ntfy.sh topic name, loading it from disk if previously generated
   or creating and saving a new random UUID topic on first run."
  []
  (if (.exists (io/file topic-file))
    (-> topic-file slurp edn/read-string :topic)
    (let [topic (str (random-uuid))]
      (spit topic-file (pr-str {:topic topic}))
      (log/infof "Generated new ntfy.sh topic and saved to %s" topic-file)
      topic)))

(defn send-notification
  "Sends a push notification with `title` and `body` to the given ntfy.sh `topic`."
  [topic title body]
  (try
    (http/post (str "https://ntfy.sh/" topic)
               {:headers      {"Title"    title
                               "Priority" "default"}
                :content-type "text/plain"
                :body         body})
    (log/infof "Notification sent: %s" title)
    (catch Exception e
      (log/errorf e "Failed to send notification: %s" title))))
