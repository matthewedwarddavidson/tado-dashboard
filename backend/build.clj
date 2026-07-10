(ns build
  "Uberjar build script — run with: clj -T:build uber"
  (:require [clojure.tools.build.api :as b]))

(def app-name "tado-data-analyser")
(def version  "0.1.0")
(def class-dir "target/classes")
(def uber-file (format "target/%s-%s.jar" app-name version))

(defn clean
  "Deletes the target directory."
  [_]
  (b/delete {:path "target"}))

(defn uber
  "Compiles the project and packages it as a standalone uberjar.
   The frontend must be built first (make build) so that
   resources/public/ is populated."
  [_]
  (clean nil)
  (let [basis (b/create-basis {:project "deps.edn"})]
    (b/copy-dir {:src-dirs   ["src" "resources"]
                 :target-dir class-dir})
    (b/compile-clj {:basis     basis
                    :src-dirs  ["src"]
                    :class-dir class-dir})
    (b/uber {:class-dir class-dir
             :uber-file uber-file
             :basis     basis
             :main      'tado-data-analyser.core}))
  (println (str "Built " uber-file)))
