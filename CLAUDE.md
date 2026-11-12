# KerayeGo Mobile — CLAUDE.md

@AGENTS.md

Guidance for AI agents modifying this codebase. Deeper technical detail lives in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — read that for anything not covered here.

Verified directly against source (Expo Router, TypeScript; full re-check 2026-11-09). `AGENTS.md` only
points at Expo's versioned docs for SDK 57 and `README.md` is the stock create-expo-app readme — neither
carries app-specific information. Where behavior is surprising or contradicts a comment, the real
behavior is stated as fact below. Note: this repo's `.gitignore` lists `docs/` (so `docs/ARCHITECTURE.md`
is untracked) and `CLAUDE.md` (this file is tracked anyway, having been added before that rule).

## What this is

A React Native app (Expo SDK ~57, Expo Router, TypeScript strict) for KerayeGo, talking to the same
`kerayego-backend` NestJS API as the web frontend — over REST (axios) **and** Socket.IO (the backend's
`/ride` namespace). Unlike `kerayego-web`, this app is **consumer-only on the rental side** (browse,
inquire, save, review — no fleet/showroom management anywhere) but implements the **full live-ride
experience web entirely lacks**: real-time driver GPS tracking on a map, in-app chat, and day-of trip
execution (start/manifest/pickup/dropoff/end) for the carpool feature, including an offline action queue
for spotty connectivity.

## Stack

Expo ~57.0.12 · Expo Router ~57.0.12 (file-based routing) · React 19.2.3 · React Native 0.86.2, New
Architecture + Hermes enabled · TanStack React Query v5 · Axios · Zod v4 + React Hook Form ·
`socket.io-client` 4.8.1 · `react-native-maps` · `react-native-keyboard-controller` (all keyboard
avoidance — the app is edge-to-edge, so Android's `adjustResize` doesn't help; see `docs/ARCHITECTURE.md`
§8) · `expo-location` + `expo-task-manager` (driver's and customer's background location) · `expo-notifications` ·
`expo-secure-store` · `expo-image-picker` (the only picker) · `expo-image` (every remote photo) ·
`expo-crypto` · `react-native-reanimated`/`react-native-worklets`, `expo-glass-effect`, `expo-symbols`,
`@expo/ui` (dependencies with no direct import anywhere in `src/`). **Unit tests:
Jest** with the `jest-expo` preset (`npm test`): 58 `*.test.ts(x)` files under `src/`, never under
`src/app/` (Expo Router would treat them as routes). No component-rendering or end-to-end tests.
**The full `npm test` hangs**: `src/features/trips/offlineSync.test.ts` never finishes; run the other files by name.

## Project structure

```
src/
  app/                  Expo Router file-based routes (see below)
  auth/                 auth-context.tsx (AuthProvider/useAuth), sessionRestore.ts (app-start restore
                        retry rules), auth-guards.ts (roleHomePath — always '/')
  api/                  client.ts (axios + shared refreshAccessToken), query-client.ts, errors.ts,
                        13 domain *.api.ts files
  constants/            config.ts (env, timeouts, near-me radii), markets.ts (PK/SA/AE phone codes; PKR for all)
  features/             one folder per domain: queries.ts (React Query hooks) + components/
    liveRide/           socket.ts (shared Socket.IO client + own reconnect loop), reconnectBackoff.ts,
                        locationEmit.ts, chatHistory.ts, components/ (LiveTripMap, ChatPanel,
                        ChatModalSheet, CustomerLocationSharingCard, CustomerLocationPermissionSheet),
                        rideVisuals.ts, geo.ts, openMapsNavigation.ts, useTripRoomPresence.ts,
                        useBlockBackButtonWhileActive.ts (shared driver+rider live-ride pieces);
                        backgroundLocation/ (driver's and customer's background location tasks, see below)
    location/           LocationField, LocationMapSheet (centre-pin map picker), usePlaceSearch.ts,
                        activeAutocomplete.ts
    trips/              offlineSync.ts (offline action queue, global flush, shared runTripAction),
                        tripActionOverlay.ts + trip components; driverCockpit/ (driver day-of-execution
                        hooks/components, see docs/ARCHITECTURE.md §10.1)
    notifications/      pushToken.ts, pushTapInbox.ts + usePushTapNavigation.ts + pushRouting.ts (tap
                        routing), chat deep links, useLiveInquiryNotifications.ts (opt-in dev bridge, off by default)
    auth/               PhoneSignInFlow, EmailSignIn, CodeEntryStep + pure phoneSignIn.ts / signInCode.ts
    phone-verification/ PhoneVerificationGate/Flow, ChangePhoneSheet, WhatsApp-updates toggle
    account/, identity/ account-deletion helpers; identity-hold banner/hook
    media/              useImagePicker.ts
    trip-inquiries/     queries.ts; riderLiveTrip/ (rider live-view hooks/components, see docs/ARCHITECTURE.md §10.1)
  storage/              secure-storage.ts (expo-secure-store), offline-trip-queue.ts (AsyncStorage),
                        active-driver-trip.ts / active-customer-share.ts (AsyncStorage: what each
                        background location task reports for), rating-prompt.ts (AsyncStorage: rides
                        whose end-of-ride rating sheet already opened once)
  components/ui/        hand-rolled design system (AppButton, AppInput, AppScreen, AppSheet, StatusBadge, ...)
  components/maps/      NearMeControl (the "near me" button — the app has no search-results map)
  components/reviews/, components/auth/   rating badges/stars/lists; AuthRequiredSheet
  theme/                tokens.ts + index.ts (useTheme) — "Sunset Coral" palette mirrored from web
  schemas/              Zod schemas: auth, profile, booking, trip, trip-inquiry, user-vehicle
  types/                api.types.ts, enums.ts — mirrors backend Prisma types/enums
  hooks/, utils/        useNow (shared 1 s clock), useAppInForeground, usePullToRefresh, ...;
                        format, rentalDuration, cnic, numberInput, tripDateTime
android/                Locally generated by `expo prebuild` — gitignored, not hand-maintained
example/                Leftover default Expo template scaffold — NOT part of the app, ignore it
```

Routes (Expo Router; parenthesized segments are route groups, stripped from the resolved URL):

- `(auth)/` — login and register (both the same phone-first WhatsApp-code flow; `login?method=email` is
  the emailed-code backup — the app has no passwords), verify-email. No guard redirects authenticated
  users away from these.
- `(public)/(tabs)/` — the real bottom tab bar (`expo-router`'s `Tabs`, 4 screens: `index` (resolves to
  `/`, "Vehicles"), `trips` ("Carpool"), `providers`, `profile`). Everything here is
  public/unauthenticated-readable. `(public)/vehicle/[id]` and `provider/[id]` are detail screens looked
  up by **slug** despite the `[id]` param name (explicit code comments in both files say so);
  `(public)/trip/[id]` really is looked up by id.
- `account/` — auth-gated stack (see Authentication below): inquiries, inquiry/[id], saved, reviews,
  profile, delete-account, my-trips/_, my-vehicles/_, trip-requests, trip-request/[id].

**Naming trap**: `components/ui/TabBar.tsx` is _not_ the app's tab bar — it's a small custom in-screen
segmented control, used by the rider's live view (`RiderLiveView`, Stops/Driver/Summary) and the
Vehicles tab ("Hourly & daily" / "Weekly & monthly"). The driver's cockpit has no tabs (its
Route/Riders/Details views are sheets). The real bottom tab navigator
is `(public)/(tabs)/_layout.tsx`'s `Tabs` component.

## Authentication & session

Three cooperating pieces, mirroring the web app's model: an **in-memory-only access token**
(`api/client.ts`, wiped on app kill), a **refresh token in `expo-secure-store`** (the only thing that
survives restarts), and `AuthContext`'s in-memory `user` + `isBootstrapping` state. **Sign-in and
sign-up are phone-first** (2026-11-06, `features/auth/PhoneSignInFlow` + `phoneSignIn.ts`, used by both
login and register): number (country chips from `constants/markets.ts`, Pakistan default) →
`POST /auth/phone/request` → WhatsApp code → `POST /auth/phone/verify` → signed in, or (`needsSignup`)
a profile step (name, email; role `USER` only) → `POST /auth/phone/register`. Both this code step and in-app
verification's show "Get the code on WhatsApp" (opens the send result's `messageUsUrl`; KerayeGo replies
with the code) — leading the step when the result says `codeSent: false`. "Sign in with email
instead" opens the emailed-code backup (`POST /auth/code/request` → `/auth/code/verify`, sign-in only).
All three store the session the same way (`AuthContext`'s `startSession`: refresh token from the body,
`deletionCancelled` shown once by `DeletionCancelledSheet`, then `GET /users/me` re-read). The backend's
password endpoints and `POST /auth/register` exist for old app versions only — never call them. On launch: read the
stored refresh token → `POST /auth/refresh` → `GET /users/me` → register push token (fire-and-forget).
Only a 401 triggers a refresh: the axios response interceptor retries once through
`refreshAccessToken()` (`api/client.ts`) — the app's single, shared, single-flight way to mint a token
(also used by bootstrap and the ride socket's reconnect), guarded by a session epoch so a refresh from a
previous session can't revive or expire the current one. The backend rejecting the refresh token
(401/403) expires the session; a transient failure (offline/5xx/429) keeps it. The same holds at app
start (2026-11-09): if the stored session can't be restored because the server can't be reached, the
refresh token is kept, the user is signed out *for now* (`isRestoringSession`; the Profile tab says
they'll be signed back in), and the restore is retried every 15 s and on every return to the foreground
until it goes through — only the server refusing the token signs them out (`auth/sessionRestore.ts`).
`X-Client-Type: mobile` is sent on every request so the backend returns the refresh token in the
response body instead of a cookie.

**Route guarding is not centralized.** `src/auth/auth-guards.ts` looks like a guard module but its only
export, `roleHomePath(role)`, always returns `'/'` regardless of role (login/register's fallback
destination when there's no `returnTo`). Real enforcement
lives in `src/app/account/_layout.tsx`, which redirects unauthenticated users to `/login`,
`ADMIN`/`SUPER_ADMIN` users to `/` (this app has no admin experience at all), and unverified-email users
to `/verify-email` unless their phone is verified (`user.phoneVerified` — a phone sign-up's email starts
unconfirmed). **Unresolved contradiction in the source itself**: this layout's own comment says
`USER` and `PROVIDER` both use the account stack, while `features/reviews/components/EligibleReviewsList.tsx`
comments "mobile has no provider role" — the two claims conflict and neither could be confirmed as
authoritative from source alone.

**WhatsApp phone verification** (2026-11-01, `features/phone-verification/`): whenever
`user.mustVerifyPhone` is true (the backend's verdict — never work it out in the app), the root layout's
`PhoneVerificationGate` covers the app with a blocking "Verify your mobile number" screen (exits: verify
or Sign out) — after sign-in, sign-up, session restore, and after any 403 `PHONE_NOT_VERIFIED`, which
`client.ts` reports to `AuthProvider` (`setOnPhoneNotVerified`) to re-read `/users/me`. Number →
`POST /users/me/phone/send-code` → 6-digit code → `POST /users/me/phone/verify`, whose user replaces the
stored one (`replaceUser`). The phone is no longer edited by `PATCH /users/me`: the profile screen
("Profile & settings") shows Verified / "Not verified · Verify" and changes it through the same flow in
an `AppSheet`, plus the optimistic "WhatsApp updates" switch (`PATCH /users/me { whatsappUpdates }`).
Only a 401 ever triggers a token refresh. Details: `docs/ARCHITECTURE.md` §6.

Push tokens are the **native platform token** (FCM on Android / APNs on iOS, via
`Notifications.getDevicePushTokenAsync()`) — **not** the Expo push token — registered on bootstrap,
every sign-in and token rotation (`POST /device-tokens`), unregistered before logout
(`DELETE /device-tokens`), and invalidated natively (no backend call) on session expiry or account
deletion. Notification **taps** are routed role-aware by `features/notifications/pushRouting.ts`
(`recipientRole` DRIVER → `/account/my-trips/:tripId`, RIDER → `/account/trip-request/:id`, bookings →
`/account/inquiry/:id`, vehicle decisions → `/account/my-vehicles/:id`), held until the session is ready.
`useLiveInquiryNotifications` (root layout) is a developer aid that fakes these notifications locally (a
10 s poll + the ride socket) for a simulator that gets no pushes. It is **off** unless
`EXPO_PUBLIC_LOCAL_PUSH_BRIDGE=true` — with it on where real pushes arrive, every notification shows
twice. iOS-simulator push payloads for testing tap routing: `npm run test:push*` (`scripts/push/`).

## State management & storage

- **Server state**: TanStack React Query everywhere. Global config (`api/query-client.ts`): 60s
  `staleTime`, retries skipped entirely for `unauthorized`/`forbidden`/`not_found`/`validation` error
  kinds (from `normalizeApiError`), otherwise retried up to 2×; mutations never retried.
- **Auth state**: React Context (`auth-context.tsx`), not Zustand/Redux.
- **Persistent storage**: `expo-secure-store` for the refresh token only (`storage/secure-storage.ts`,
  key `auth.refreshToken.v2`, `AFTER_FIRST_UNLOCK` so the background task can refresh on a locked
  iPhone; the old `auth.refreshToken` key is read as a fallback and removed on the next write).
  `AsyncStorage` backs the offline trip-action queue (`storage/offline-trip-queue.ts`): every item is
  stamped with its user and trip and read per user, with a 24 h TTL / 20 counted attempts and a log of
  discarded actions (`trips.offlineQueue.dropped`) shown to the driver. AsyncStorage also holds `liveRide.activeDriverTrip`
  (`storage/active-driver-trip.ts`), the trip and driver the background location task is sharing for, and
  `liveRide.activeCustomerShare` (`storage/active-customer-share.ts`), the seat/booking and customer the
  customer location task is sharing for.
- **Module-level singletons** (not React state): the shared Socket.IO connection (`features/liveRide/socket.ts`,
  torn down only on logout/expiry), `activeAutocomplete.ts` (cross-field autocomplete-dropdown
  exclusivity, mirroring the same pattern documented on `kerayego-web`), the offline queue's session
  store, the location tasks' status stores, and `hooks/useNow.ts`'s shared 1-second clock.

## API layer & backend communication

13 domain `*.api.ts` files (auth, users, listings, providers, booking-requests, reviews, trips,
trip-inquiries, user-vehicles, geo, location-sharing, media, device-tokens) + `errors.ts`
(`normalizeApiError`, 9 error kinds, passes through the backend's `error.code` and `retryAfterSeconds`;
`isRetryableErrorKind`) + `client.ts` (axios instance, 30 s timeout, `X-Client-Type: mobile`, shared
refresh). The dominant pattern is unwrapping `res.data.data` (paginated lists return `{ data, meta }`) —
the only exceptions are 4 mutations that return `void` (`deviceTokensApi.register`/`unregister`,
`usersApi.removeSavedVehicle`, the user-vehicle delete `DELETE /my/vehicles/:id`). There is no media
delete call. `normalizeApiError`'s friendly-message table has no dedicated entry for
`validation`/`conflict` kinds — those fall back to a generic message absent a backend-supplied one.

`types/enums.ts` mirrors 17 backend Prisma enums plus mobile-only derived helpers (`userBookingActions`,
`tripPosterActions`, `tripInquiryRiderActions`/`PosterActions`) that gate which UI actions appear per
status — some of these **hardcode a narrower result than the mirrored transition tables actually allow**
(e.g. `userBookingActions` only ever offers `CANCELLED`, even though `BOOKING_TRANSITIONS`'s own `PENDING`
row lists `USER` as allowed to reach `CONTACTED`/`REJECTED` too). Every status enum but `UserStatus` has a
`*StatusMeta` label/tone map there. "Document type" comes in two lists: `enums.ts`'s `DocumentType`
(10 values) and `UserVehicleDocumentType` (the 4 a personal vehicle carries; the form iterates
`USER_VEHICLE_DOCUMENT_TYPES` from `features/user-vehicles/userVehicleDraft.ts`).

## Rental flow (consumer-only)

Browse listings/providers (infinite scroll), vehicle/provider detail, send a rental request, save/unsave
a vehicle, leave a review. **There is no vehicle-listing-creation or
showroom-management screen anywhere in this app**, and no rental-listing schema. The visually similar "My vehicles" under
`account/my-vehicles/*` is a **different domain** — it registers a user's personal carpool vehicle
(`userVehicleFormSchema`), not a rental listing.

**Rental request redesign (built 2026-11-12, plan §3c/§3d, A74–A87; backend contract in root
`docs/API_CONTRACTS.md` "Rental booking redesign")** — details in `docs/ARCHITECTURE.md` §9:
- **Browse** has two sections (A84): "Hourly & daily" and "Weekly & monthly" (`weeklyMonthly=true`,
  "Price to agree" + "Ask for a price"). **No week or month prices anywhere** (A79). Cards and the car
  page say **"This exact car"** with the car's own `carRating` (A87, `CarRatingLine`).
- **The request sheet** (`InquiryFormSheet`, "Request this car"): package (6 h / 12 h / Days, plus Week
  and Month "price to agree" on cars switched on for it), the count only where it applies (days 1–6,
  weeks 1–4, months 1–12 — never "quantity"), pickup time, One way / Round trip, pickup and drop-off
  points **picked** by search or map (the carpool `TripStopsSection`, `variant="rental"`, ≤10 in all),
  passengers (≤ seats), week/month hours per day / days per week / km per month, and the **route
  estimate** (`POST /booking-requests/estimate`, debounced) — Send is disabled while the package doesn't
  fit, with a "Choose 12 hours" button. It sends **only the new request shape** (`stops`, `tripType`,
  `passengerCount`; the first pickup's and last drop-off's `city` looked up on send) and handles
  `ROUTE_DOES_NOT_FIT` (suggestion from `error.details`), `START_TIME_PAST`, `ROUTE_UNAVAILABLE`.
  Package rules: `utils/rentalDuration.ts`; payload/estimate/errors: `features/booking-requests/rentalRequest.ts`;
  route wording (same as KerayeGo Partner): `bookingRoute.ts`.
- **Booking detail**: package, trip type, passengers, start/end times, total or "Price to agree", the
  Route (stops with expected times, km, driving time), and the **driver card** (A86 — photo, rating,
  rides, "Identity verified" / "Licence verified", never "safe").
- Once this build ships, tell the backend chat so it can refuse the old request shape (§3c step 4).

## Carpool flow & live ride (the standout feature vs. web)

Full public search → post a trip (gated on an `APPROVED` personal vehicle) → rider requests seats → **day-of
execution**, which web has no equivalent of at all: `account/my-trips/[id].tsx` is the driver's cockpit
(Start trip → a **leg-by-leg** live view: navigate to the current stop, **Arrived** within 100 m or
automatically after 15 s within 50 m, a per-stop checklist of riders — Picked up / no-show after 5 min /
Dropped off — then **Start next leg**; Route/Riders/Details sheets; **End ride** → `DriverRideSummary`),
backed by an **offline action queue** (per-user AsyncStorage FIFO, flushed app-wide from the root layout
on foreground and every 15 s, and on the trip screen on mount and after each enqueue — never in the
background). `account/trip-request/[id].tsx` is the rider's live view (tabbed Stops/Driver/Summary,
self-reported arrival and **Reached** at drop-off, chat, call/WhatsApp). Both screens hide the header,
disable swipe-back and block the Android back button while the ride is locked. There is no trip-edit
screen (and no client call to `PATCH /my/trips/:id`). **Every trip time is Pakistan time**
(`utils/tripDateTime.ts`, the same rule as web): displays format in `Asia/Karachi` with a "PKT" /
"(Pakistan time)" hint when the phone is in another zone, and the post-a-trip picker's reading is
taken as Pakistan time (`tripWallClockToInstant`, mirroring web's `karachiLocalToISOString`).

**Live tracking**: a single shared Socket.IO connection (`features/liveRide/socket.ts`) to the backend's
`/ride` namespace. Two GPS sources, one at a time: while the app is open, the cockpit's
`watchPositionAsync` watch (4s/10m) emits over the socket; once the server confirms the trip
`IN_PROGRESS`, an `expo-location` **background task** (`features/liveRide/backgroundLocation/`, 10s/25m)
keeps sharing after the driver leaves the app, posting batches to `POST /my/trips/:id/location`. Owner
decisions: When-In-Use permission only (never "Allow all the time"); iOS background location mode with the
blue indicator; Android foreground service with a "Trip in progress" notification that **dies when the
app is swiped away**. The task is registered from the custom entry `index.js` so it exists even when the
OS starts the app without UI; binaries without `expo-task-manager` have no background sharing, and the
cockpit says so. It stops on trip end, logout, the active ride going away, or a 404/409 (or a 401/403
after refresh) from the location endpoint. **Customer sharing** (carpool riders and rental customers): a second task,
`kerayego.customer-location`, posts the customer's position to their driver every ~10 s in the foreground
and background while the backend says a window is open (until pickup); `useCustomerLocationReconcile`
(root layout) polls `GET /users/me/location-sharing` and starts it from the foreground only, after a short
permission explanation sheet; the rider screens and rental booking detail show a "Sharing your location
with your driver" card with Stop/Resume. Never both tasks at once for one person. The rental booking
detail also shows the assigned driver live (`/live-driver`, polled 10 s), and the driver cockpit shows
riders' shared positions. Details: `docs/ARCHITECTURE.md` §12. The socket is created with
`autoConnect: false`, connected explicitly when a token exists, and runs **its own** jittered reconnect
loop (refreshing the token first) when the server refuses or closes the connection; it's torn down on
logout/expiry. **Chat** (`ChatModalSheet`/`ChatPanel`) rides the same socket: full history paged via
`meta.nextCursor`, a catch-up fetch after every room join, room joined only in the foreground,
optimistic-send-then-reconcile by client-generated UUID, typing throttling and read receipts.

Google Places/geocoding calls are **proxied through the backend** (`/geo/*`), not called directly from
the device — mobile's own Maps API key is Maps-SDK-only (map tile rendering), not Places-scoped.

## Native config & build

Expo SDK 57, New Architecture + Hermes on. `android/` is a **gitignored, locally-generated** project
(regenerated by `expo prebuild`) — not hand-maintained; there is **no `ios/` directory** in this repo and
**no `eas.json` anywhere** in the repo or its parent workspace. Release Android builds currently sign
with the **debug keystore** and have minification/shrinking **off by default** — both need real
configuration before a production release. `google-services.json` points to Firebase project
`rentalmarketplave` — the same project the backend sends from (verified) — but Firebase has this app
registered as **`com.rentalmobile.app`**; the file was hand-edited to `com.kerayego.app` and works only
because the API key isn't package-restricted. There's no Firebase iOS app, so **iOS push doesn't work**:
the iOS build registers an APNs token, which FCM rejects (see root `docs/ENVIRONMENT_GUIDE.md`).
`expo-dev-client` is a dependency; combined with `react-native-maps`,
`socket.io-client`, and reanimated 4, this app cannot run in plain Expo Go and needs a custom dev client
build.

## Known gaps / things that will surprise you

- `npm run test:push`/`test:push:chat`/`test:push:trip` (`xcrun simctl push …`) need a Mac with a booted
  iOS simulator. Their payloads (`scripts/push/*.apns`) carry `REPLACE_WITH_…` ids — put real ones in
  to land on a real screen. The push data sits under the payload's top-level `"body"` key, because
  that's where expo-notifications reads an iOS remote notification's data from.
- `npm run type-check` (`tsc --noEmit`) is the standalone type-check.
- The `EligibleReviewsList.tsx` vs. `account/_layout.tsx` contradiction on whether `PROVIDER` accounts
  use this app at all (see Authentication above) is unresolved in the source itself.
- Release Android signing/minification is not production-ready (debug keystore, no shrink/minify).
- Tests are unit-only: nothing renders components or runs the app end to end.
- **Rental copy doesn't state the no-self-drive rule yet** (root `CLAUDE.md` → Product rules). There's no
  self-drive wording anywhere in `src/` (checked 2026-11-10), but nothing says every car comes with the
  provider's driver or that providers check documents before confirming — web says both since
  2026-10-14. The owner deferred mobile copy work on 2026-10-15; add it when that work starts.

## Where to go deeper

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers every screen, hook, and business rule
in full, plus a consolidated list of verified discrepancies and open unknowns.
