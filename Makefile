.PHONY: backend frontend frontend-install build start jar help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

backend: ## Start the backend only, for development (http://localhost:3000)
	cd backend && clj -M:main

frontend-install: ## Install frontend npm dependencies
	cd frontend && npm install

frontend: frontend-install ## Start the frontend dev server (http://localhost:5173)
	cd frontend && npm run dev

build: frontend-install ## Build frontend into backend/resources/public/
	cd frontend && npm run build

start: build ## Build frontend then start the combined server (http://localhost:3000)
	cd backend && clj -M:main

jar: build ## Build a standalone uberjar (backend/target/tado-dashboard-*.jar)
	cd backend && clj -T:build uber
