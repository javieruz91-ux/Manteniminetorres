---
name: Web publication for the Expo maintenance app
description: The browser and Expo Go entrypoints share one build without changing local-first behavior.
---

The maintenance app must publish an Expo web export at the browser root while keeping iOS and Android manifests available through the Expo platform header. The browser trial may read the owner XLSX through a no-login, read-only endpoint and must never seed it into the shared database.

**Why:** The mobile artifact's original production server intentionally returned an Expo Go launcher for browser requests, so a valid React Native Web codebase was unreachable from the public URL.

**How to apply:** Keep browser routes as an SPA with static XLSX fallback, keep `/api` outside SPA fallback, and preserve native manifest routes when changing the production build.