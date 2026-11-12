# KerayeGo Mobile — Architecture Reference

Deep technical reference for `kerayego-mobile`, built by directly reading the source (Expo Router
screens/layouts, hooks, API wrappers, native config) and fully re-checked against it on 2026-11-09. The
repo's other Markdown (`AGENTS.md` — a pointer to Expo SDK 57's docs; `README.md` — the stock
create-expo-app readme) carries no app-specific information. Where a claim could not be confirmed from
code actually read, it is marked **Unknown**. Where the code contradicts a comment or another file's
comment, the code's actual behavior is stated as fact and the discrepancy is flagged.

For a condensed, agent-facing summary, see [`kerayego-mobile/CLAUDE.md`](../CLAUDE.md).

---

## 1. Overview

KerayeGo Mobile is a React Native app (Expo SDK ~57, Expo Router, TypeScript strict, New Architecture +
Hermes) talking to the same `kerayego-backend` NestJS API as `kerayego-web`, over both REST (axios) and
Socket.IO (the backend's `/ride` namespace). Its scope differs meaningfully from web:

- **Narrower on rental**: strictly consumer-facing (browse, inquire, save, review). No vehicle-listing-
  creation or showroom-management screen exists anywhere in this app — confirmed by a full recursive
  listing of `src/app` and `src/features` (there is no rental-listing schema in `src/schemas/` either).
- **Much richer on carpool**: this is the only client (of the three in this workspace) with day-of trip
  execution UI, live GPS tracking, and in-app chat — features `kerayego-web` entirely lacks.
- **Unit tests with Jest**: `jest-expo` preset, 58 `*.test.ts(x)` files under `src/` (none under
  `src/app/`), run with `npm test` (§18).
- **Background execution for location only**: two `expo-location` tasks, never both at once for one
  person (§12) — while a carpool trip the user is driving is `IN_PROGRESS`, the driver's location keeps
  reaching their riders after they leave the app; and while the backend says a carpool rider's or rental
  customer's sharing window is open (until pickup), the customer's location keeps reaching their driver.
  Everything else (the offline queue's flush loop, the socket connection, React Query polls) only runs
  while the app is foregrounded.

One unresolved fact worth flagging up front: the mobile source contains a **direct, unresolved
contradiction** about whether `PROVIDER`-role accounts use this app at all —
`features/reviews/components/EligibleReviewsList.tsx` comments "mobile has no provider role," while
`src/app/account/_layout.tsx` comments that both `USER` and `PROVIDER` share that same account stack
(only `ADMIN`/`SUPER_ADMIN` are redirected away). Neither file resolves this; it is stated here as an
open contradiction, not silently resolved one way.

## 2. Framework & Versions

Expo ~57.0.12 · Expo Router ~57.0.12 (`main: "index.js"` in `package.json`: a custom entry that
registers the background location tasks — driver's and customer's, §12 — then loads `expo-router/entry`) · React 19.2.3 /
React DOM 19.2.3 · React Native 0.86.2 · TypeScript ~6.0.3 (strict mode, via `expo/tsconfig.base`) ·
TanStack React Query ^5.101.4 · Axios ^1.19.0 · Zod ^4.4.3 + `@hookform/resolvers` + `react-hook-form` ·
`socket.io-client` 4.8.1 · `react-native-maps` 1.27.2 · `expo-location` ~57.0.16 · `expo-task-manager`
~57.0.21 (driver's and customer's background location, §12) · `expo-notifications`
~57.0.18 · `expo-secure-store` ~57.0.1 · `expo-image-picker` ~57.0.9 (the only picker; there is no
document picker) · `expo-image` ~57.0.2 (`Image`, used for every remote photo — vehicle/provider/trip
cards, galleries, personal-vehicle photos and documents) · `expo-crypto` ~57.0.1 ·
`@react-native-async-storage/async-storage` 2.2.0 · `react-native-keyboard-controller` 1.21.9 (§8) ·
`@react-native-community/datetimepicker` 9.1.0 · `@expo-google-fonts/outfit` · `react-native-reanimated`
4.5.1 + `react-native-worklets` 0.10.1, `expo-glass-effect`, `expo-symbols`, `@expo/ui`,
`expo-web-browser`, `expo-device`, `expo-constants`, `expo-linking`, `expo-system-ui` (dependencies with
**no direct import anywhere in `src/`** — grep confirmed; whether other packages need them at runtime
wasn't checked, so don't remove them on this basis alone). `eslint-config-expo` + flat ESLint config; no Prettier config found.
Unit tests: Jest ~29.7 with `jest-expo` 57.0.4 and `@react-native/jest-preset` 0.86.2 (§18).

`app.config.js` experiments: `typedRoutes: true`, `reactCompiler: true`.

## 3. Project Structure

```
kerayego-mobile/
  src/
    app/                        Expo Router file-based routes (§5)
      _layout.tsx                 Root: providers, fonts, splash hold, push-tap routing, active-ride lock,
                                   global offline-queue flush, location-task reconcilers, root sheets (§4)
      (auth)/                     login, register (both the phone-first WhatsApp-code flow; login?method=email
                                   is the emailed-code backup), verify-email
      (public)/                   Public stack wrapping (tabs) + vehicle/provider/trip detail screens
        (tabs)/                    Real bottom tab bar: index (Vehicles), trips, providers, profile
      account/                    Auth-gated stack: inquiries, inquiry/[id], saved, reviews, profile,
                                   delete-account, my-trips/*, my-vehicles/*, trip-requests, trip-request/[id]
      +not-found.tsx
    auth/                        auth-context.tsx (AuthProvider/useAuth), sessionRestore.ts (app-start restore
                                  retry rules, §6), auth-guards.ts (roleHomePath, always '/')
    api/                         client.ts (axios + shared refreshAccessToken), query-client.ts, errors.ts,
                                  13 domain *.api.ts files (auth, users, listings, providers,
                                  booking-requests, reviews, trips, trip-inquiries, user-vehicles, geo,
                                  location-sharing, media, device-tokens)
    constants/                   config.ts (env-driven API URL/app env, timeouts, near-me radii),
                                  markets.ts (PK/SA/AE: labels, phone calling codes; currency is PKR for all)
    features/                    One folder per domain: queries.ts (React Query hooks) + components/
      liveRide/                    socket.ts, LiveTripMap, ChatPanel, ChatModalSheet, rideVisuals.ts
                                    (shared "reached"/avatar colors), geo.ts (haversine + short distance
                                    format), openMapsNavigation.ts, useTripRoomPresence.ts,
                                    useBlockBackButtonWhileActive.ts (both shared by driver + rider),
                                    components/RideAvatar.tsx, locationEmit.ts, queries.ts (customer
                                    location sharing); backgroundLocation/ — the driver's and the
                                    customer's background location tasks (§12)
      location/                    LocationField, LocationMapSheet (+ MapPlaceSearch, MapPickerControls),
                                    usePlaceSearch.ts, mapRegion.ts, activeAutocomplete.ts
      trips/                       offlineSync.ts (useOfflineTripQueue + shared runTripAction helper) +
                                    trip components; driverCockpit/ — the driver day-of-execution
                                    hooks/components consumed by account/my-trips/[id].tsx (§10.1)
      notifications/                pushToken.ts, push-tap routing/inbox, chat deep links, live inquiry
                                    notifications (§13)
      media/                        useImagePicker.ts
      auth/                         PhoneSignInFlow, EmailSignIn, CodeEntryStep, DeletionCancelledSheet +
                                    pure phoneSignIn.ts / signInCode.ts (§6)
      phone-verification/           PhoneVerificationGate/Flow, ChangePhoneSheet, GetCodeOnWhatsApp,
                                    WhatsAppUpdatesToggle + pure phoneVerification.ts / whatsappToggle.ts (§6)
      account/                      accountDeletion.ts (delete-account helpers, §6)
      identity/                     useIdentityHold, IdentityHoldBanner (§10)
      listings/, providers/, booking-requests/, saved-vehicles/, reviews/, user-vehicles/
      trip-inquiries/               queries.ts; riderLiveTrip/ — the rider live-view hooks/components
                                    consumed by account/trip-request/[id].tsx (§10.1)
    storage/                     secure-storage.ts (expo-secure-store), offline-trip-queue.ts (AsyncStorage),
                                  active-driver-trip.ts / active-customer-share.ts (AsyncStorage; what each
                                  background location task reports for, §12), rating-prompt.ts
                                  (AsyncStorage; rides whose rating sheet already opened once, §9)
    components/
      ui/                          Hand-rolled design system (AppButton, AppInput, AppScreen, ...)
      maps/                        NearMeControl (the "near me" button; there is no search-results map)
      reviews/                     RatingBadge, RatingStars, RatingSummaryBadge, ReviewsList
      auth/                        AuthRequiredSheet (guest "log in or sign up first" prompt)
    theme/                       tokens.ts + index.ts (useTheme) — "Sunset Coral" palette mirrored from web
    schemas/                     Zod schemas: auth, profile, booking, trip, trip-inquiry, user-vehicle
    types/                       api.types.ts, enums.ts — mirrors backend Prisma types/enums
    hooks/                       useCurrentLocation.ts, useDebouncedValue.ts, usePullToRefresh.ts,
                                  useAppInForeground.ts, useNow.ts
    utils/                       format.ts, rentalDuration.ts, cnic.ts, numberInput.ts, tripDateTime.ts
  index.js                      Custom entry: registers both background location tasks, then expo-router/entry
  android/                      Locally generated by `expo prebuild` — gitignored, not hand-maintained
  google-services.json          Firebase/FCM config (byte-identical copy also under android/app/)
  app.config.js                 Sole Expo config source (no app.json exists)
  example/                      Leftover default Expo template scaffold — NOT part of the app (gitignored,
                                 excluded from tsconfig and Jest)
  scripts/push/                 iOS-simulator push payloads (*.apns) for `npm run test:push*` (§17)
  docs/                         This file only — note `.gitignore` lists `docs/`, so it is untracked
```

## 4. Bootstrap & Navigation Shell

`src/app/_layout.tsx` is the composition root:

```
GestureHandlerRootView > KeyboardProvider(statusBarTranslucent, navigationBarTranslucent, preserveEdgeToEdge)
  > SafeAreaProvider > QueryClientProvider(queryClient) > AuthProvider > RootNavigator + StatusBar
```

At module scope (before anything renders) it calls `SplashScreen.preventAutoHideAsync()`,
`configureNotificationHandler()` (§13) and `startPushTapCapture()` — so a notification tap that launches
the app, or lands while the session is still restoring, is held until it can be routed (§13).

`RootNavigator` blocks all rendering (`return null`, keeping the native splash screen up) until **all
four** Outfit weights (400/500/600/700) are loaded (`useFonts`) **and** `AuthProvider`'s
`isBootstrapping` resolves — so no screen, protected or not, is ever shown before the session bootstrap
completes. It runs eight app-wide hooks (`signedInUserId` = the user's id once signed in and
bootstrapped):

- **`usePushTapNavigation({ ready, userId, onAuthScreen })`** — routes notification taps where the
  payload says, role-aware, once the session and navigator are ready and the user isn't on an `(auth)`
  screen (§13).
- **`usePushReceivedInvalidation(userId)`** — a push received in the foreground invalidates the queries
  it affects (§13).
- **`useLiveInquiryNotifications(userId)`** — a developer aid that fakes ride notifications locally; it
  does nothing unless `EXPO_PUBLIC_LOCAL_PUSH_BRIDGE=true` (§13).
- **`usePushTokenRefresh(isAuthenticated)`** — subscribes to native push-token rotation only while
  logged in; unsubscribes when `isAuthenticated` flips false.
- **`useActiveRideLock(isAuthenticated && !isBootstrapping)`** — polls `GET /my/active-ride` every 20s
  (`useMyActiveRide`) and force-`router.replace()`s onto the locked ride screen
  (`activeRidePathname`: `/account/my-trips/:tripId` for a driver, `/account/trip-request/:tripInquiryId`
  for a rider) if the user has an active ride and isn't already there (pathname compare only, so a chat
  push's query param on the locked screen survives). This is what re-locks a user back into an
  in-progress ride if they reopen the app mid-trip or navigate away.
- **`useGlobalOfflineQueueFlush(userId)`** — replays the user's queued day-of-trip actions wherever they
  are in the app (§11).
- **`useDriverLocationReconcile` / `useCustomerLocationReconcile`** — stop the driver's background
  sharing once their ride is over or the account changes; start/stop the customer's sharing as the
  backend's windows open and close, returning the permission prompt the root renders (§12).

Top-level `<Stack>` has four screens: `(public)`, `(auth)`, `account`, `+not-found` — all with
`headerShown: false` at this level; individual group layouts set their own header styling. After the
stack, `RootNavigator` renders the root-level sheets (`CustomerLocationPermissionSheet`,
`DeletionCancelledSheet`) and, last, **`PhoneVerificationGate`** — the blocking WhatsApp
"Verify your mobile number" screen (§6).

Nested layouts:
- `(auth)/_layout.tsx` — plain stack, no guard logic (an authenticated user is **not** redirected away
  from `/login` etc. — whether intentional is undetermined from the code).
- `(public)/_layout.tsx` — themed `<Stack>` (background/tint from `useTheme()`); nests `(tabs)` with
  `headerShown: false` and gives `vehicle/[id]`, `provider/[id]`, `trip/[id]` an empty title (the screens
  set their own header content).
- `(public)/(tabs)/_layout.tsx` — the **real** bottom tab bar: Expo Router's own `Tabs` component, 4
  screens (`index` → "Vehicles", `trips` → "Carpool", `providers` → "Providers", `profile` → "Profile")
  each with an outline/filled Ionicons `tabBarIcon`. This is unrelated to `components/ui/TabBar.tsx`
  (see §8) — the custom component is an in-screen sub-view switcher (the rider's live view and the
  Vehicles tab's two sections).
- `account/_layout.tsx` — where auth/role/verification guarding actually happens (§6).

## 5. Screens (Full Route Inventory)

Expo Router route groups (parenthesized folders) are stripped from the resolved URL — confirmed directly
by `account/saved.tsx`'s `router.push('/')` navigating to the Vehicles tab, and by every other in-app
navigation call using un-prefixed paths.

| Resolved path | File | Notes |
|---|---|---|
| `/login`, `/register`, `/verify-email` | `(auth)/*.tsx` | See §6 |
| `/` (Vehicles tab) | `(public)/(tabs)/index.tsx` | "Hourly & daily" / "Weekly & monthly" sections (A84), infinite single-column vehicle list, search, filters, near-me button (`NearMeControl`, no map), favorites toggle (auth-gated) |
| `/trips` (Carpool tab) | `(public)/(tabs)/trips.tsx` | Public carpool trip search, popular-routes rail (`RouteGroupCard`), "Post a trip" (guests → login with `returnTo`) |
| `/providers` | `(public)/(tabs)/providers.tsx` | Provider directory |
| `/profile` | `(public)/(tabs)/profile.tsx` | Logged-out welcome/login CTA, or authenticated stats + menu |
| `/vehicle/[slug]` | `(public)/vehicle/[id].tsx` | Vehicle detail (param named `[id]`, looked up by slug — explicit code comment) |
| `/provider/[slug]` | `(public)/provider/[id].tsx` | Provider detail (same slug-vs-`[id]` naming) |
| `/trip/[id]` | `(public)/trip/[id].tsx` | Public trip detail, looked up by **id** (`GET /trips/:id`), "Request seats" / WhatsApp contact; the poster sees a "Manage this trip" card |
| `/account/inquiries`, `/account/inquiry/[id]` | `account/inquiries.tsx`, `inquiry/[id].tsx` | Customer's own rental booking requests |
| `/account/saved` | `account/saved.tsx` | Saved vehicles |
| `/account/reviews` | `account/reviews.tsx` | Wraps `EligibleReviewsList` |
| `/account/profile` | `account/profile.tsx` | "Profile & settings": name form, mobile number (Verified badge / "Not verified · Verify", change via WhatsApp code), "WhatsApp updates" switch, logout — distinct from the tabs Profile screen |
| `/account/delete-account` | `account/delete-account.tsx` | Delete account (see §6 "Account deletion"); opened from the tabs Profile screen's last row |
| `/account/my-trips`, `/new`, `/[id]` | `account/my-trips/*.tsx` | Poster's trips list, post-a-trip form, driver day-of-execution cockpit |
| `/account/trip-requests`, `/account/trip-request/[id]` | `account/trip-requests.tsx`, `trip-request/[id].tsx` | Rider's own sent seat requests + live-ride view |
| `/account/my-vehicles`, `/new`, `/[id]`, `/edit/[id]` | `account/my-vehicles/*.tsx` | Personal (carpool) vehicle registration (with the owner's CNIC number), detail, edit/resubmit |

## 6. Authentication & Session

Three cooperating pieces:

1. **In-memory access token** — module-level variable in `src/api/client.ts`, attached via a request
   interceptor, never persisted (gone on app kill).
2. **Refresh token in `expo-secure-store`** (`storage/secure-storage.ts`) — the only thing that survives
   restarts, and the only auth item stored. Key `auth.refreshToken.v2`, written with
   `keychainAccessible: AFTER_FIRST_UNLOCK` so iOS can read it on a locked phone (the driver's background
   location task refreshes its access token mid-trip, often screen-locked). The pre-migration key
   `auth.refreshToken` is still read as a fallback and deleted on the next write (a keychain item's
   accessibility can't be changed in place). The web target falls back to `window.localStorage`,
   explicitly commented as **not secure** (web preview only).
3. **`AuthContext`'s in-memory `user` + `isBootstrapping`** (`auth-context.tsx`).

**Bootstrap**: read stored refresh token → if absent, stop immediately (no user, `isBootstrapping=false`)
→ else `refreshAccessToken()` (`client.ts`'s shared refresh, `POST /auth/refresh`) → `GET /users/me` →
set the offline-queue owner (`setOfflineQueueOwner`) and both location tasks' session user
(`setDriverLocationSessionUser`/`setCustomerLocationSessionUser`) → `registerPushToken()`
(fire-and-forget). This is `AuthProvider`'s `restoreSession()`, which never rejects and sets no React
state itself (the caller puts the user in state). When it fails (2026-11-09):
- **The server refused the session** (refresh rejected 401/403, or `GET /users/me` 401/403/404/400) →
  all auth storage and the in-memory token are cleared: signed out.
- **The server couldn't be reached** (offline, timeout, 5xx, 429, or a non-HTTP error such as the
  keychain not readable yet — `auth/sessionRestore.ts`'s `sessionRestoreFailureAction`, unit-tested) →
  the refresh token is **kept**, the in-memory token dropped, and `isRestoringSession` set: the user is
  signed out for now (the Profile tab's logged-out view says "Can't reach KerayeGo right now. You'll be
  signed back in automatically once you're connected."), and the restore is retried every 15 s
  (`SESSION_RESTORE_RETRY_MS`, only while not backgrounded) and on every return to the foreground, until
  it goes through or the server refuses it.
- A `sessionGenerationRef`, bumped by every sign-in (`startSession`) and session end (`clearSession`),
  makes a restore that was in flight when someone signed in or out do nothing (`'stale'`), and both of
  those stop the retries.

**Sign-in and sign-up are phone-first — no passwords anywhere in the app** (2026-11-06; contract in root
`docs/API_CONTRACTS.md`). `login.tsx` and `register.tsx` both render the same
`features/auth/components/PhoneSignInFlow` (only the number step's heading differs — the backend decides
sign-in vs sign-up); state is a pure reducer and error mapping in `features/auth/phoneSignIn.ts`:
1. **Number**: a country chip row (Pakistan +92 default, Saudi Arabia +966, UAE +971 —
   `constants/markets.ts`'s `phoneCallingCode`, mirrored from the backend's markets config) + the number
   (Zod `phoneSignInSchema`); `composePhoneNumber` puts the calling code in front of a local number
   (`0300 1234567` → `+923001234567`; anything typed with `+`/`00` is sent as typed) →
   `POST /auth/phone/request` (the same 200 for any number). Send errors reuse in-app verification's
   `sendCodeError`: `CODE_RESEND_TOO_SOON` → a live "Wait Ns…" countdown from `error.retryAfterSeconds`
   that disables Continue; `CODE_LIMIT_REACHED`, 502 `WHATSAPP_SEND_FAILED`, 503 `WHATSAPP_UNAVAILABLE`,
   a 400 invalid number → a message under the field.
2. **Code**: "We sent a 6-digit code to your WhatsApp.", the number with **Change** (back to step 1, which
   keeps what was typed and offers "Enter the code sent to …"), digits only, sends itself at 6 digits,
   "Send again" after the server's `resendInSeconds` (a 429 there moves the countdown) →
   `AuthContext.signInWithPhone` → `POST /auth/phone/verify`. Any 401 (`CODE_INVALID`) → "That code is
   wrong or has expired. Ask for a new one."; a 403 (suspended) → the server's message.
   `needsSignup: false` → the session is stored exactly as the email-code sign-in does (below) and the
   screen goes to `returnTo` (else `/`). `needsSignup: true` → step 3, holding the `signupToken`.
   **"Get the code on WhatsApp"** (2026-11-09, shared with in-app verification below): when the send
   result (`/auth/phone/request` or `/users/me/phone/send-code`) has `messageUsUrl`, a button opens that
   wa.me link (`Linking.openURL`, `GetCodeOnWhatsApp`) — the person sends "Send my KerayeGo code" and the
   backend replies with the code, typed into the same field. `codeSent: false` (the template couldn't be
   sent) → "Tap below to get your code on WhatsApp." and the button leads, primary, above the field;
   otherwise it's an outline fallback under "Send again". Both fields come from the latest send
   (`codeDeliveryOf`; missing on an older backend = sent, no link).
3. **Profile** (new number only): name + email (Zod `phoneProfileSchema`) →
   `AuthContext.registerWithPhone` → `POST /auth/phone/register` with `role: USER` (this app never sends
   `PROVIDER`) → the same session storing. A token past its 30 minutes, or a 401 `SIGNUP_TOKEN_INVALID`,
   or a 409 `PHONE_TAKEN` → back to step 1 with a message; 409 `EMAIL_TAKEN` → under the email, with a
   "Sign in with email instead" link prefilled with that email; a 403 (`IDENTITY_BLOCKED`) → the server's
   message above the button. "Use a different number" goes back to step 1.

**"Sign in with email instead"** (number step, and after `EMAIL_TAKEN`) pushes `/login?method=email`
(`features/auth/components/EmailSignIn`, sign-in only — there is no email sign-up any more): email →
`POST /auth/code/request` (always the same 200 answer, `resendAfterSeconds: 60`) → the shared
`CodeEntryStep` (digits only, sends itself at 6 digits; "Send again" after the countdown; "Use a different
email") → `AuthContext.signInWithCode` → `POST /auth/code/verify`. "Use my mobile number instead" goes
back. **Session storing** (`AuthContext`'s shared `startSession`, used by all three sign-ins): access
token in memory, refresh token from the body persisted (`X-Client-Type: mobile`), then `GET /users/me` is
re-read (a code proves the email or the phone, `PENDING_VERIFICATION` → `ACTIVE`, so neither the account
layout's verify-email redirect nor the phone gate fires on stale data; the sign-in's own `user` is the
fallback), `registerPushToken()` fired. A sign-in whose response has `deletionCancelled: true` sets
`deletionCancelledNotice`, shown once by the root-level `DeletionCancelledSheet` ("Welcome back. Your
account deletion has been cancelled."). The backend's password endpoints (`/auth/login`,
forgot/reset/change-password) and `POST /auth/register` remain for old app versions only; this app calls
none of them. `verify-email.tsx` stays for older unverified sessions and email links, and re-reads the
user (`refreshUser`) after a successful verify while signed in. A phone sign-up's email starts
unconfirmed (the backend emails a link); the account layout lets a `phoneVerified` user through anyway
(see Route guarding below).

**WhatsApp phone verification** (2026-11-01; `features/phone-verification/`, contract in root
`docs/API_CONTRACTS.md`): every account must verify its mobile number with a 6-digit WhatsApp code when
the backend says so — the app follows **`user.mustVerifyPhone`** only (the backend's
`PHONE_VERIFICATION_REQUIRED` flag, never `ADMIN`, number not verified) and never decides for itself.
`User`/`AuthUser` mirror `phoneVerified`, `mustVerifyPhone`, `whatsappUpdates` (all optional for older
backends: a missing `mustVerifyPhone` never gates), and `types/api.types.ts`'s `PhoneErrorCode` mirrors
the error codes. `PhoneVerificationGate` (root layout, a full-screen `Modal` over whatever is showing, so
the navigation underneath is untouched) shows whenever the signed-in user has `mustVerifyPhone` — after
sign-in, sign-up, session restore, and after any **403 `PHONE_NOT_VERIFIED`**: `client.ts` calls
`setOnPhoneNotVerified`'s handler (registered by `AuthProvider`), which re-reads `GET /users/me` once per
burst (skipped while the gate already shows) and stores it (`userAfterPhoneNotVerified`: the re-read
user decides; if the read fails, the current user is marked `mustVerifyPhone`). The gate is blocking: no
×, no backdrop, Android back does nothing; the only ways out are verifying or **Sign out**. Its body is
the shared `PhoneVerificationFlow`: step 1, the number (prefilled with `user.phone`, Zod
`sendPhoneCodeSchema`) → "Send code on WhatsApp" (`POST /users/me/phone/send-code`; `alreadyVerified`
re-reads the user instead), with the small print about WhatsApp updates; step 2, the code entry modelled
on `CodeEntryStep` (sends itself at 6 digits, "Sent to WhatsApp +92 300 1234567", "Send again" after the
server's `resendInSeconds`, "Change number") → `POST /users/me/phone/verify`, whose returned user
replaces the stored one (`AuthContext.replaceUser`, also the `['me']` cache) and every query is
invalidated so whatever failed underneath reloads. Messages (`phoneVerificationErrorMessage`):
`PHONE_TAKEN` → "This number is on another KerayeGo account. Contact KerayeGo support.",
`CODE_RESEND_TOO_SOON` → a live "Wait Ns…" countdown from `error.retryAfterSeconds` (or the
`Retry-After` header, else 60 s) that also disables the button, `CODE_LIMIT_REACHED` → "Too many codes
today. Try again tomorrow.", `WHATSAPP_SEND_FAILED`/`CODE_INVALID`/a 400 invalid number → the server's
message, `WHATSAPP_UNAVAILABLE` → a fixed "not available right now". The profile screen
(`account/profile.tsx`, "Profile & settings") no longer edits the phone in its form: it shows the number
with a **Verified** badge or **Not verified · Verify**, and "Change number"/"Add number" opens
`ChangePhoneSheet` (an `AppSheet` around the same flow). Its **Settings** section has the
**WhatsApp updates** switch ("Booking and trip updates on WhatsApp") → `PATCH /users/me
{ whatsappUpdates }`, optimistic on the `['me']` cache with rollback on error
(`whatsappToggle.ts`'s `whatsappUpdatesMutationOptions`), disabled with "Verify your number first" until
`phoneVerified`. The `/ride` socket is not gated by the backend.

**Logout**: `unregisterPushToken()` is explicitly awaited **before** `clearSession()` — a code comment
explains it needs the still-valid access token to authenticate the unregister call, which would be gone
after `clearSession()` nulls it. `authApi.logout()`'s own network call is best-effort (errors swallowed).
`clearSession(reason)` (`'logout' | 'expired' | 'deleted'`), in order: clears the offline-queue owner
(queued actions stay on the device, scoped to their user, §11), stops both background location tasks and
clears their session user, nulls the in-memory token (a new session epoch), disconnects the ride socket
(it stays authenticated as whoever handshook until closed), invalidates the device push token natively
for `expired`/`deleted` (logout already unregistered it with the backend), wipes secure storage, clears
`user` and the deletion notice, and calls `queryClient.clear()`.

**Account deletion** (plan A16, A20, A51; `account/delete-account.tsx`, helpers in
`features/account/accountDeletion.ts`): the screen says what is deleted (profile and contact details,
saved cars, personal cars with their photos and documents, driver details) and kept (reviews written,
shown as "Deleted user"; booking/trip history without the name), that deletion happens 72 hours later and
signing in again or the email link cancels it, and that active bookings, trips and seat requests must be
finished or cancelled first. Optional reason (≤500 chars) → confirm `Alert` →
`usersApi.requestAccountDeletion` (`POST /users/me/delete-request`). A 400 shows the backend's message
inline. On success the backend has already revoked every refresh token, so the screen leaves the account
stack (`router.dismissTo('/')`, before the session goes so `account/_layout.tsx` never redirects to
login), then calls `endSessionAfterAccountDeletion()` — `clearSession('deleted')`, which is logout's
local cleanup with **no** backend call (no `/auth/logout`, no `DELETE /device-tokens`); like an expired
session it invalidates the device push token natively instead — and shows "Your account will be deleted
on <date>…" in an `Alert`. An unverified-email account can't reach the screen (the account layout sends
it to `/verify-email` first, unless its phone is verified).

**401 handling** (`client.ts`'s response interceptor): only a 401 ever refreshes — never a 400/403 (so
`POST /users/me/phone/verify`'s 400 `CODE_INVALID` and the gate's 403 `PHONE_NOT_VERIFIED` don't; the
latter only calls the phone-gate handler above). It excludes `/auth/refresh`, `/auth/code/*` and `/auth/phone/*` URLs (a wrong code's 401 `CODE_INVALID`, or phone sign-up's 401 `SIGNUP_TOKEN_INVALID`, says nothing about a session)
and already-retried requests from triggering a refresh. If the in-memory token already differs from the
one the failed request carried (another caller refreshed meanwhile), it just retries with the current
token; otherwise it awaits **`refreshAccessToken()`** — the app's one way to mint a token, shared by this
interceptor, the ride socket's reconnect (§12) and bootstrap. It is single-flight (concurrent callers
share one in-flight promise, because the backend rotates the refresh token on every use and rejects a
second presentation of the same one) and **session-epoch-guarded**: `setAccessToken()` (login, logout,
expiry) bumps a `sessionEpoch`, and a refresh that started under an older epoch neither writes its tokens
back nor expires the newer session. Outcomes: new token → the request replays once; the backend
**rejecting** the refresh token (401/403) or no stored token while one was in memory → the session is
expired once (storage cleared, `onSessionExpired()` — a settable callback registered by `AuthProvider`,
kept as a callback to avoid a circular import) and the request rejects; a **transient** failure (offline,
timeout, 5xx, 429) → the request rejects with that error and the session is kept.

**Route guarding is not centralized.** `src/auth/auth-guards.ts` exports only `roleHomePath(role)`, whose
two branches both unconditionally `return '/'` — login and register use it as the post-sign-in fallback
when there's no `returnTo`; it guards nothing. Real enforcement is in `src/app/account/_layout.tsx`: redirects (in order) unauthenticated → `/login`,
`ADMIN`/`SUPER_ADMIN` → `/` (no admin experience exists on mobile at all), unverified email → `/verify-email`
— unless the phone is verified (`user.phoneVerified`, e.g. a phone sign-up whose emailed link hasn't been
used yet: the backend treats the WhatsApp code as the proof of identity).
See §1 for the unresolved `USER`/`PROVIDER` contradiction between this file's comment and
`EligibleReviewsList.tsx`'s comment.

The account stack itself declares header titles for its screens; `trip-request/[id]` sets its own
("Trip request") in the route file, and `trip-requests` sets none (Expo Router's default, the route name).

No biometric authentication (Face ID/fingerprint) exists anywhere in `src/` (confirmed by repo-wide grep).

## 7. State Management

- **Server state**: TanStack React Query, configured globally in `api/query-client.ts`: `staleTime` 60s;
  `retry` skips entirely for error kinds `unauthorized`/`forbidden`/`not_found`/`validation` (from
  `normalizeApiError`), else retries up to 2×; mutations never retried. `normalizeApiError` also passes
  the backend's `body.error.code` through as `code` (e.g. `IDENTITY_ON_HOLD`) when the response has one.
- **Auth state**: React Context, not a global store library.
- **Persistent storage**: `expo-secure-store` (refresh token, §6), `AsyncStorage` (offline trip-action
  queue, key `trips.offlineQueue`, one list whose every item is stamped with its user and trip and read
  per user + trip, 24 h TTL / 20 counted attempts, plus `trips.offlineQueue.dropped`, the log of
  discarded actions — §11; key `liveRide.activeDriverTrip`, the one trip — and its driver — the driver's background location
  task is sharing for; key `liveRide.activeCustomerShare`, the one seat/booking — and its customer —
  the customer's location task is sharing for, §12; and one key per ride,
  `ratingPrompt.shown:<tripDriver|tripRider|booking>:<id>` (`storage/rating-prompt.ts`), marking that the
  end-of-ride rating sheet already opened on its own on this device, §9).
- **Module-level singletons**: the shared Socket.IO connection (`features/liveRide/socket.ts`, state read
  via `useSyncExternalStore`) and `activeAutocomplete.ts` (cross-field Places-dropdown exclusivity) both
  use a plain module-level variable + `Set<Listener>` pub-sub pattern rather than React context, since
  sibling instances (e.g. pickup/dropoff fields) share no common React ancestor. The same pattern holds
  `offlineSync.ts`'s session store (queue owner, applied actions, in-flight flushes),
  `offline-trip-queue.ts`'s storage lock and change listeners, the driver's and customer's location
  status stores (§12), and `hooks/useNow.ts`'s one shared 1-second clock (paused in the background; used
  by every countdown/"x ago" label). `hooks/useAppInForeground.ts` is true unless `AppState` is
  `'background'` (iOS `inactive` counts as foreground) — it gates chat, the location watch, the
  reconcilers and the 10 s polls.
- **Optimistic local state**: heavily used by the driver's `useDriverTripActions` hook
  (`features/trips/driverCockpit/`) and the rider's `useRiderTripActions` hook
  (`features/trip-inquiries/riderLiveTrip/`) to overlay in-flight/offline-queued actions on top of query
  data (`optimisticStarted`, `optimisticEvents`, `noShowIds`, `arrivedStopIds`, etc.) until the real
  refetch supersedes them.

## 8. Design System & Reusable UI

`components/ui/` is a fully hand-rolled set — no equivalent of Radix here; every primitive wraps plain
React Native core components (`View`, `Text`, `Pressable`, `TextInput`, `ScrollView`,
`ActivityIndicator`) plus `react-native-safe-area-context` (`AppScreen`),
`react-native-keyboard-controller` (`FormScrollView`, `AppScreen`, `AppSheet`) and
`@react-native-community/datetimepicker` (`DateField`). Remote images throughout the app (outside
`components/ui`) use `expo-image`'s `Image`. Nothing in `src/` imports `expo-glass-effect`,
`expo-symbols`, `@expo/ui`, `react-native-reanimated`, or `react-native-worklets` (confirmed by grep).

- **`AppButton`** — 5 variants (primary/secondary/outline/ghost/danger), `loading`/`fullWidth`, 48px
  minimum touch height, coral shadow only on the `primary` variant.
- **`AppCard`** — themed `View` (surface background, card radius, border, `shadows.xs`).
- **`AppInput`** — label/error/helper text (no password mode — the app has no password fields).
- **Keyboard handling** — the app is edge-to-edge (`edgeToEdgeEnabled=true`), so Android's
  `adjustResize` no longer shrinks the window when the keyboard opens. Avoidance comes entirely from
  `react-native-keyboard-controller`. Its `KeyboardProvider` wraps the root layout with
  `statusBarTranslucent`/`navigationBarTranslucent`/`preserveEdgeToEdge`, so it doesn't add bar margins
  on top of the safe-area insets. While the provider is on, it also sets every `Modal` window to
  `adjustNothing`, so **any input inside a `Modal` must use one of the patterns below**. Adding the
  library needed a native rebuild (it's not something a JS reload picks up).
- **`FormScrollView`** — the scroll view for any screen with text inputs: a `KeyboardAwareScrollView`
  that scrolls the focused input to sit `spacing.xl` above the keyboard. A field can ask for more room
  below the input with `useKeyboardSpaceBelow(px)`; `LocationField` does this while its suggestions
  dropdown is open, so the dropdown clears the keyboard too. Changing `bottomOffset` makes the library
  re-check the focused input, which is what triggers that scroll. Used by `AppScreen`,
  `DriverPostedTripView` (decline note) and `DriverRideSummary` (as its plain scroll container — it has
no inputs of its own; rating happens in `RateSheet`).
- **`AppScreen`** — `SafeAreaView` (configurable edges) + optional `ScrollView`
  (`keyboardShouldPersistTaps='handled'`). `scroll` + `keyboardAvoiding` renders a `FormScrollView`
  instead. `keyboardAvoiding` alone renders the library's `KeyboardAvoidingView` (`behavior='padding'`,
  `automaticOffset`). Accepts a `refreshControl`, applied only in `scroll` mode.
- **`AppRefreshControl`** — themed `RefreshControl` (coral spinner), forwarding every prop. Paired with
  `hooks/usePullToRefresh.ts`, which keeps `refreshing` as local state (not a query's `isFetching`, so
  background polling/invalidation never flashes the spinner) and resolves once the screen's own
  `refetch()` calls do. Every data screen has pull-to-refresh: the 4 tabs, the vehicle/provider/trip
  detail screens (which also invalidate `['reviews']` for their child rating/review queries), and every
  `account/` list/detail screen. Deliberately **excluded**: form screens (auth, `my-trips/new`,
  `my-vehicles/new`, `account/profile` — a refetch could overwrite unsaved input) and the in-progress
  live views (`DriverLiveCockpit`, `RiderLiveView` — kept current by the socket and polling);
  `my-trips/[id]` and `trip-request/[id]` only wire it into their pre-live views.
- **`AppSheet`** — the standard bottom sheet (`Modal` + 40% scrim + `radii.sheet` top corners, optional
  `title`/`subtitle`; `height` for fill-the-space content like a map, `flush` for full-bleed content like
  chat; padded bodies add the bottom safe-area inset). A content-sized sheet (no `height`) rides up on
  top of the keyboard, via the library's `KeyboardAvoidingView` with `behavior='padding'`. It shrinks
  (and its inner `ScrollView` scrolls) if it no longer fits, never above the status bar, and drops the
  bottom inset while the keyboard is up. A fixed-`height` sheet stays put and its content handles the
  keyboard itself: `ChatPanel` uses the library's `KeyboardAvoidingView` with `automaticOffset`, since it
  isn't at the top of the screen. **Convention: every sheet/modal must close via a
  top-right × button, a tap on the backdrop outside it, and the Android back button** — `AppSheet`
  provides all three; with the keyboard open, the first backdrop tap only dismisses the keyboard (so a
  half-filled form isn't thrown away). Every sheet in the app is built on it: `FilterSheet`,
  `TripFilterSheet`, `InquiryFormSheet`, `TripInquiryFormSheet`, `RateSheet` (the one rating sheet),
  `LocationMapSheet`, `ChatModalSheet`, `DriverLiveCockpit`'s end-ride confirm, `RiderConfirmSheet`,
  `AuthRequiredSheet`, `ChangePhoneSheet`, `DeletionCancelledSheet`, `CustomerLocationPermissionSheet`,
  `ChatLinkUnavailableSheet`, `my-vehicles/[id]`'s "Delete this vehicle?" confirm and
  `my-vehicles/edit/[id]`'s "Resubmit without changes?" confirm. The only other `Modal` is `PhoneVerificationGate` — deliberately **not** a
  sheet: a full-screen blocking cover with no ×, no backdrop and a no-op Android back (§6).
- **`AppText`** — 5 typography variants, each pinned to a specific loaded Outfit static-font PostScript
  name (React Native ignores `fontWeight` for non-variable custom fonts, so each variant must reference
  the exact weight's font family directly).
- **`DateField`** — iOS shows an inline `spinner`-display `DateTimePicker` toggled by a local
  `showIosPicker` flag; Android uses the imperative `DateTimePickerAndroid.open()`, chaining a `date`
  dialog then a `time` dialog for `datetime` mode and merging the results.
- **`StatusBadge`** — purely presentational (label + tone → colored pill). The status→tone mapping lives
  centrally in `types/enums.ts` as per-domain `*StatusMeta` records — `bookingStatusMeta` (plus
  `bookingStatusDisplay()`, safe for a status this build doesn't know), `vehicleStatusMeta`,
  `tripStatusMeta`, `userVehicleStatusMeta`, `tripInquiryStatusMeta`, `providerStatusMeta`,
  `documentStatusMeta` (every status enum except `UserStatus`, which no screen badges).
- **`TabBar`** — a custom in-screen segmented pill switcher (tap-only by explicit design, no swipe, "to
  avoid accidental tab changes on map screens"), used by the rider's live view
  (`features/trip-inquiries/riderLiveTrip/RiderLiveView.tsx`, Stops/Driver/Summary — §10.1) and the
  Vehicles tab ("Hourly & daily" / "Weekly & monthly", §9). The driver's live cockpit has no tabs: its
  Route/Riders/Details views are `AppSheet`s opened from `LegPanel`. **Not** the app's bottom tab bar
  (see §4/§5).
- **`States.tsx`** — `LoadingState`/`EmptyState`/`ErrorState`, all custom, composing `AppText`/`AppButton`.
- **`Row`/`DetailRow`** — plain label/value line components (caption-sized and body-sized respectively);
  shared across the carpool trip/vehicle detail screens and the driver/rider day-of-execution views.

`theme/tokens.ts` documents itself as the "4321-Drive design system v3 — Sunset Coral" (an internal
codename distinct from the public "KerayeGo" brand, same mismatch as on the web app). The **light**
color palette, spacing, radii, font sizes, and status-tone colors are commented as mirroring
`kerayego-web`'s Tailwind config exactly (hex-for-hex). The **dark** palette and dark status-tone colors
are explicitly commented as this app's **own original extrapolation** — `kerayego-web` is light-mode-only
and has no dark palette to mirror. `theme/index.ts`'s `useTheme()` picks light/dark via React Native's
`useColorScheme()` and also returns `isDark`.

## 9. Rental Flow (Consumer-Only)

`features/listings`, `features/providers`, `features/booking-requests`, `features/saved-vehicles`,
`features/reviews` + their screens. All pure REST via React Query — **no Socket.IO usage anywhere in
this code path** (confirmed by grep; Socket.IO is confined to `features/liveRide/socket.ts`).

- Public browse (`(tabs)/index.tsx`) and provider directory (`(tabs)/providers.tsx`), both infinite-
  scroll, with URL-independent local filter state (no query-param persistence like web's browse page).
  **Two browse sections (A84, 2026-11-12)**: the Vehicles tab's `TabBar` switches between **Hourly &
  daily** (every car, at its day price) and **Weekly & monthly** (`GET /listings?weeklyMonthly=true` — cars
  the business switched on; each `VehicleCard` shows "Price to agree" and an **Ask for a price** button
  that opens the request sheet on Week, guests → `/login?returnTo=/vehicle/<slug>`). A car can be in
  both. The switch hides while "My favorites" is on. The filters (city, make, price, seats…) apply to
  both sections; the price filter and sort are the day price's.
- Vehicle/provider detail screens are keyed by **slug** despite the `[id]` route-param name.
- **The rental request ("Request this car", `InquiryFormSheet`, 2026-11-12, plan §3c, A74–A85)** — an
  `AppSheet` for one car (`RentalRequestCar`: id, title, seats, the listing's prices and
  `offersWeeklyMonthly`), opened from the car page ("Request this car", or "Ask for a price" → Week) or a
  weekly & monthly card. Zod `rentalRequestSchema(seats)` (`schemas/booking.schema.ts`); pure logic in
  `utils/rentalDuration.ts` (packages) and `features/booking-requests/rentalRequest.ts` (payload,
  estimate input, errors, the estimate panel's words) — both unit-tested. In order:
  - **Package** chips (`packageOptions`): 6 hours and 12 hours when the car prices them, **Days** (always),
    then **Week** and **Month** ("Price to agree") only when `offersWeeklyMonthly`. The count only where it
    applies — a `Stepper` "Number of days" 1–6 ("For 7 days or more, choose Week or Month"), weeks 1–4,
    months 1–12; hour packages take none (A74). The word "quantity" never shows.
  - **Pickup date & time** (week/month: "Start date & time"), in the future.
  - **Trip** — One way / Round trip (A76), priced packages only, no default (the choice changes the fit).
  - **Pickup points** and **drop-off points** — the carpool form's `TripStopsSection` with
    `variant="rental"`: at least one of each, at most 10 in all (each card's limit is what the other
    leaves), every place **picked** from the suggestions or the map (A75): typing in a place clears the
    coordinates a pick gave it, and the schema refuses a stop without them ("Pick this place from the
    suggestions or on the map"). No per-stop note field yet (the API takes one).
  - **Passengers** `Stepper`, 1 to the car's seats (A83).
  - **Week/month** (A85): the driver's hours per day (1–24, default 10), days per week (1–7, default 6) and
    kilometres per month (optional). No route, no estimate, no trip type.
  - **Route estimate** (priced packages, A77 — `EstimatePanel`, `useBookingEstimate` →
    `POST /booking-requests/estimate`): asked once the time, trip type and every place are set
    (`estimateInputOf`), again whenever any of them or the package changes — the input is debounced
    700 ms (the endpoint allows 20 a minute), no automatic retries, answers cached 5 min. It shows
    "330 km · 5 h 20 min driving" (round trip: ", there and back"), "About 7 h 10 min with stops and
    breaks", then either "✓ Fits 12 hours — about 4 h 50 min to spare" + "Ends around 6:30 PM" (+ round trip
    "About 3 h at Larkana"), or "This trip needs about 7 h 10 min (330 km). Choose 12 hours." with a
    **Choose 12 hours** button that switches the package (no package fits: "…It's too long for this car's
    packages."). **Send is disabled while the picked package doesn't fit.** `ROUTE_UNAVAILABLE` (503) or a
    network error shows **Try again**; `ROUTE_NOT_FOUND` the server's message.
  - **Price**: priced → "Total for 12 hours PKR …" (`packageTotal`, a preview — the server works it out);
    week/month → "Price to agree … The business will call you to agree the price." + the end date.
  - **Message** (optional), then **Send request** (week/month: **Ask for a price**).
  - **Sending** (`createPayloadOf`, the new request shape — never the old free-text place fields): the
    stops (pickups, then drop-offs), `passengerCount`, `tripType` (priced) or `driverHoursPerDay`/
    `daysPerWeek`/`kmPerMonth` (week/month), `durationQuantity` only where a count applies. Before it,
    `withEndStopCities` (`stopCities.ts`) reverse-geocodes the **first pickup and the last drop-off**
    (`GET /geo/reverse`, best-effort) to send their `city` — the backend copies those into
    `pickupCity`/`dropoffCity`, which the return-trip rule (A48) reads; a picked place has coordinates
    but no city.
  - **Failures** (`rentalRequestFailure`): `ROUTE_DOES_NOT_FIT` → the server's message and a **Choose …**
    button from `error.details.suggestion`; `START_TIME_PAST` → under the date field; the 409 "You
    already have an active inquiry for this vehicle" → that message plus **View my inquiries** (any
    `conflict`; after `COMPLETED`/`CANCELLED`/`REJECTED`/`NOT_STARTED` the car can be requested again);
    `IDENTITY_ON_HOLD` → the hold banner; anything else → the server's message. `normalizeApiError` keeps
    a coded error's `error.details` object as `details` (a validation field list stays `fieldErrors`).
  - On success: `['myInquiries']` refreshes and the app goes to `/account/inquiries`.
- **Saved vehicles**: the per-vehicle heart-icon `SaveButton` is **always rendered** regardless of auth
  state (redirects to `/login` on tap if unauthenticated); the Vehicles tab's separate "My favorites"
  view-toggle is a **different control** that is only rendered at all when `isAuthenticated` is true —
  a logged-out user cannot see it in the first place.
- **Reviews**: `EligibleReviewsList` renders the same four buckets as web
  (`bookingsAsCustomer`/`bookingsAsProvider`/`tripsAsRider`/`tripsAsDriver`) from one
  `GET /reviews/my/eligible` call; its own comment claims "mobile has no provider role" (see §1's
  unresolved contradiction). What each row asks is built in `features/reviews/rateTargets.ts`, mirroring
  `ReviewsService`'s allowed entries exactly (a wrong entry fails the whole batch): a rental asks "How was
  the car?" (`VEHICLE`) and, only when the booking had an `assignedDriver`, "How was your driver?"
  (`USER`); a carpool trip as rider asks about the car (`USER_VEHICLE`, or `VEHICLE` = `fleetVehicleId`
  on a return trip) and the driver. **Never the business** (A18) — the provider and vehicle detail
  screens show no business rating or reviews either, only the car's. Submit is all-or-nothing
  (`buildReviewPayload`), since the backend drops the row from "to rate" after any one review.
  The rating UI itself is one component, `features/reviews/components/RateSheet.tsx`, shared by this list
  and the end-of-ride prompts below. It can hold several rides at once (a driver's riders), sending one
  `POST /reviews` per fully rated ride (`buildReviewPayloads`); a 409 counts as saved; after saving it
  shows a short thank-you and closes, and `useCreateReview` refreshes the eligible list.
- **Car rating line** (`components/reviews/RatingSummaryBadge` → `RatingBadge`): a car's summary
  (`GET /reviews/summary`, `VEHICLE`/`USER_VEHICLE`) covers the car's whole **plate** (every listing, any
  owner; backend plan A17). When its `rideCount` is above 0 the line adds "· N rides on KerayeGo" in the
  same muted style (`rideCountLabel`, `features/reviews/plateHistory.ts`); `USER` summaries never show it.
  **"This exact car" (A87, 2026-11-12)**: rental cars use `features/listings/components/CarRatingLine` —
  "This exact car · ★ 4.6 (12) · 30 rides on KerayeGo" from the listing's own `carRating`
  (`{ averageRating, reviewCount, rideCount }`, on `GET /listings`, `/listings/:slug` and saved vehicles),
  on every `VehicleCard` and the car page. An older backend sends no `carRating`: the car page then asks
  `GET /reviews/summary` itself; a card just says "This exact car" (one request per card would be too
  many). "Plate checked by KerayeGo" isn't shown — the listing doesn't say yet. The carpool trip detail
  still uses `RatingSummaryBadge`.
- **End-of-ride rating prompt** (`features/reviews/useRatingPrompt.ts` + pure helpers in
  `features/reviews/ratingPrompt.ts`): the carpool driver's ride summary, the rider's post-ride view and
  the rental booking detail each open `RateSheet` on their own once the ride is over **on the server** and
  `GET /reviews/my/eligible` still lists it — that list is the only source of truth for "unrated". It opens
  **once per ride per device** (marked in AsyncStorage as it opens, `storage/rating-prompt.ts`), so closing
  it with × or **Later** never brings it back automatically; a "Rate …" card (`RatePromptCard`) stays on
  the screen while the ride is unrated, and Profile → Reviews still works. It waits ~0.7 s after the
  ride-over view appears, never opens on top of another sheet on that screen, and not while the
  active-ride lock is loading or about to redirect elsewhere (`isLockRedirectPending`). The eligible list
  is invalidated when the ride ends (the hook on ride-over, `useEndTrip`, and an offline-queue flush that
  applied an `end`). Rows per screen: the driver's `tripsAsDriver` for that `trip.id`
  (`driverTripPendingRatings`, one rating each), the rider's `tripsAsRider` row
  (`riderTripPendingRating` → `riderTripRating`, so a business return trip rates the fleet car), the
  customer's `bookingsAsCustomer` row (`customerBookingPendingRating` → `customerBookingRating`).
- **No fleet management**: confirmed by a full recursive route/feature listing — only read-only display
  code touches showrooms/fleet, and there is no rental-listing schema. `listings.api.ts` exposes only
  `GET` endpoints (`/listings`, `/listings/:slug`, `/listings/meta/makes`,
  `/listings/meta/cities`). The similarly-named `account/my-vehicles/*` registers a **personal carpool
  vehicle** (`userVehicleFormSchema`), a different domain entirely.
- **Vehicle detail** (`vehicle/[id].tsx`): gallery (`VehicleGallery`, paged with dots), "This exact car"
  with the car's rating and rides (`CarRatingLine`), the day price and the 6/12-hour prices the car has —
  **no week or month prices** (A79; the backend stopped sending them 2026-11-11) — and, on a car switched
  on for it, "Weekly & monthly · Price to agree" with an **Ask for a price** link (the request sheet on
  Week). WhatsApp to the showroom number (`wa.me`), and **Request this car** — a guest tapping either goes
  straight to `/login?returnTo=…` (the `AuthRequiredSheet` prompt is used only on the trip detail). The
  sheet is mounted fresh for each way in (`key`).
- **My inquiries** (`account/inquiries.tsx`): each card says the package and the route in one line —
  "12 hours · Hyderabad → Larkana · 330 km" (`packageLabel`, `routeSummaryLine`; an older request: its
  free-text pickup) — then the dates and the business.
- **Limits**: saved vehicles and the favorites view load at most 100 (no infinite scroll there); "My
  inquiries" loads page 1, limit 50, with no further paging; "Cancel inquiry" has no confirmation.
- `ReviewSubjectType` still has a `PROVIDER` member (mirroring the backend), but the app never sends it
  (A18). (Removed 2026-11-09 as unused: the `ResultsMap` component, `useFeaturedVehicles`/`useListings`
  and `listingsApi.getFeatured`.)
- **Booking detail** (`account/inquiry/[id].tsx`):
  - **The request** (2026-11-12): package ("12 hours", "3 days", "1 week — price to agree"; an old row
    "6 hours × 2"), trip (One way / Round trip), passengers, pickup (week/month: starts) and end with their
    times, then the total — or "Price to agree" with "The business will call you to agree the price." An
    older request without stops shows its free-text pickup/drop-off places and the car's day rate. A week
    or month request adds the driver's hours per day, days per week and kilometres per month (A85).
  - **Route** (`BookingRouteCard`, A78): every pickup and drop-off in route order with when the car should
    get there (`expectedAt`; the time alone on the pickup's day, else the date too), the drive from the
    stop before, then the route's km and driving time (round trip: there and back, and the drive back on
    its own), "About … with stops and breaks", and "Times are estimates". Week/month stops have places but
    no times. Wording shared with KerayeGo Partner (`features/booking-requests/bookingRoute.ts` mirrors
    its `bookingRoute.ts`: "330 km", "7 h 10 min").
  - **Driver card** (`RentalDriverCard`, A86 — `rentalDriverCard` decides): once a driver is assigned and
    the booking is `ACCEPTED`, `IN_PROGRESS` or `COMPLETED` — the driver's photo (else initials), name,
    rating and rides ("★ 4.8 (23) · 41 rides on KerayeGo", `assignedDriver.rating`/`rideCount`), and
    "✓ Identity verified" / "✓ Licence verified" badges — each only when true, never "safe". Call/WhatsApp
    only while `ACCEPTED` with the phone sent; during the rental the live card has them.
  - While the booking is `IN_PROGRESS`,
  `RentalLiveDriverCard` shows the assigned driver on a `LiveTripMap` (no stops; framed on and following
  the driver) with their recent path as the line, the driver's name, **Call**/**WhatsApp** buttons
  (`DriverContactActions`) and "Location updated x ago" — `GET /booking-requests/:id/live-driver` and
  `/live-route`, each polled every 10 s while the screen is open in the foreground (no socket for rentals).
  The backend sends the driver's phone to the customer (`assignedDriver.phone`,
  live-driver `driver.phone`) only while `IN_PROGRESS`, or `ACCEPTED` with the driver's job accepted (D14);
  otherwise it's `null` and both cards hide Call/WhatsApp (the driver card says "You can call your
  driver once they confirm the job"). A `NOT_STARTED` booking (backend cron: the booked period ended
  without the job starting; terminal, grey "Not started" badge, never rateable) gets a short explanation
  card. The screen also shows the customer's own
  "Sharing your location with your driver" card while the booking's sharing window is open (§12). Once
  the booking is `COMPLETED` and still in `bookingsAsCustomer`, the end-of-ride rating sheet opens (car,
  and the driver when one was assigned) and a **Rate your rental** card stays until it's rated — the
  "Rental completed" push (`booking.jobCompleted`) lands on this screen, so it covers that tap too.
- `account/profile.tsx` ("Profile & settings": name form, WhatsApp-verified phone, WhatsApp updates
  switch, logout — §6) and `(tabs)/profile.tsx` (the tab: a
  logged-out welcome/login screen, or an authenticated dashboard with stats + a menu linking into
  `account/*`) are two distinct screens, not the same one reused.

## 10. Carpool Flow (Trips, Trip Inquiries, User Vehicles)

`features/trips`, `features/trip-inquiries`, `features/user-vehicles` + their screens.

- **Posting a trip** (`TripForm`) is gated client-side on having at least one `APPROVED` personal
  vehicle (`useMyApprovedUserVehicles`); submit is disabled with none. The **trip itself is not
  admin-gated** — a code comment and the post-trip screen's own copy ("Your trip goes live immediately
  once posted") confirm it's created `ACTIVE` immediately; only the `UserVehicle` needs admin approval.
  `TripStatus.PENDING_REVIEW`/`REJECTED` are marked in `enums.ts` as legacy values the backend no longer
  produces for trips. Pickup and drop-off stops (1–10 each) are entered in two separate
  `TripStopsSection` cards, each with its own icon and numbered markers: pickup in coral, drop-off in
  ink, the same split as the driver's `LegPanel` header and `RouteOverview`. Each stop's map picker is
  titled "Set pickup point" / "Set drop-off point". `tripFormSchema` allows 1–20 seats; seat and price
  inputs go through `utils/numberInput.ts` (empty → `null`). After posting, the screen `replace`s to
  `/account/my-trips`. **There is no trip-edit screen** and no client call to `PATCH /my/trips/:id` (the
  unused `useUpdateTrip`/`tripsApi.update` were removed 2026-11-09); `tripPosterActions` still lists
  `'edit'` for an `ACTIVE` trip, mirroring what the backend allows, but nothing renders it.
- **Requesting seats** (`TripInquiryFormSheet`) requires one `PICKUP` and one `DROPOFF` `TripStop` from
  the trip's structured `stops` array (not free text): "Send request" is disabled only when the trip has
  no pickup or no drop-off stops at all; pressing it without choosing both shows inline "Pickup/Dropoff
  location is required" errors. A guest
  tapping "Request seats" gets `components/auth/AuthRequiredSheet` (Log in / Create account)
  instead of the form; both buttons carry `returnTo=/trip/[id]`, which login and register (both the
  phone-first flow, §6) send the user to once signed in, and their "Sign up"/"Log in" links forward. If a
  submit still comes back `unauthorized` (session expired with the form open), the sheet closes and the
  same prompt opens instead of showing the raw token error.
- **Seat requests on the driver's trip** (`DriverPostedTripView`, while the trip is `ACTIVE`):
  Accept/Decline a `PENDING` request, **Cancel seat** on an `ACCEPTED` one (A49), the destructive two
  behind an inline confirmation with an optional note the rider sees (`tripInquiryPosterActions`). The
  inbox is fetched with `limit: 100` so every open request is visible. **Cancel trip** is disabled while
  any request is `PENDING`/`ACCEPTED` (`openSeatRequestCount`) with "Cancel or decline each seat
  first" — `TripsService.cancel` refuses otherwise (also disabled while the inbox loads); it has no
  confirmation step and sends no reason. Backend messages are shown per request on failure.
- **Lists**: `my-trips` and `trip-requests` load page 1 (limit 50) only, with no further paging.
  `useTripInquiry` polls every 20 s while the seat is `ACCEPTED`, not dropped off, and the trip is
  `ACTIVE`/`IN_PROGRESS`. (The unused seat-request count hooks and their `/trip-inquiries/counts` and
  `/my/trip-inquiries/counts` calls were removed 2026-11-09.)
- **Times — every trip time is Pakistan time** (`utils/tripDateTime.ts`, `Asia/Karachi`, the same rule
  as web's `lib/utils/datetime.ts`; unified 2026-11-09). Every screen formats `departureAt` with
  `formatTripDateTime`/`formatTripTime`: the carpool `TripCard`, `trip/[id]`, the `my-trips` and
  `trip-requests` lists, `DriverPostedTripView`, `DetailsTab`, `DriverRideSummary` and the rider's views.
  When the phone isn't on Pakistan time, compact rows add " PKT" (`tripTimeZoneShortSuffix`) and detail
  rows " (Pakistan time)" (`tripTimeZoneSuffix`). **Posting**: the date/time picker works in the phone's
  zone, so its reading is taken as Pakistan time — `tripWallClockToInstant` (mirrors web's
  `karachiLocalToISOString`) builds `departureAt` on submit, `tripFormSchema`'s "must be in the future"
  check uses the same conversion, and the field is labelled "Departure date & time (Pakistan time)" off
  Pakistan time. `PreTripConfirmationCard`'s countdown runs on the server clock.
- **Return trips for riders**: trip-inquiry responses carry `isReturnTrip`/`fleetVehicle`/
  `providerProfile`; the rider's screens read the car through `riderTripVehicle` (`tripDisplay.ts`, on top
  of `features/trips/tripVehicle.ts`) and show the fleet car plus "Operated by <business>". The fleet
  car has no plate or market, so its fare falls back to the default currency.
- **Personal vehicle registration** (`account/my-vehicles/new.tsx`) generates a client-side
  `expo-crypto` UUID up front so photo/document uploads land in one storage folder (`users/{id}/vehicles/{vehicleId}/`) before the vehicle record
  exists; requires all 4 verification documents (CNIC front/back, driving license, vehicle registration)
  plus up to 6 photos. A `REJECTED` or `PENDING_REVIEW` vehicle can be edited and resubmitted
  (`account/my-vehicles/edit/[id].tsx`, `PATCH /my/vehicles/:id`, only what changed is sent —
  `userVehicleDraft.ts`). Both share `UserVehicleForm`, which also requires **"Your CNIC number"**
  (person blocks, A22/D18): typed digits are formatted as `12345-1234567-1` (`utils/cnic.ts`'s
  `formatCnicInput`) and checked against the backend's `CNIC_PATTERN` (`/^\d{5}-?\d{7}-?\d$/`), with the
  helper "Only KerayeGo sees this. It's used to verify you." It is sent as `cnicNumber` on create, and on
  edit only when it differs from the `cnicNumber` that `GET /my/vehicles/:id` returned (prefilled from
  it; empty for a vehicle registered before it was asked for, so the form asks for it then). A CNIC that
  matches a person KerayeGo blocked is refused with 403 `IDENTITY_BLOCKED`; the form shows the server's
  message like any other save error.
- **Deleting a personal vehicle** (`account/my-vehicles/[id].tsx`, `useDeleteUserVehicle`,
  `DELETE /my/vehicles/:id`, 204): a "Delete vehicle" button opens an `AppSheet` confirmation (permanent —
  photos and documents go too; past trips keep their history with no vehicle). Disabled with a one-line
  reason for a `SUSPENDED` vehicle; the backend's 409 for a vehicle with a `PENDING_REVIEW`/`ACTIVE`/
  `IN_PROGRESS` trip is shown in the sheet. On success the lists refetch and the screen
  `dismissTo`s `/account/my-vehicles`.
- **Car history notice** (`account/my-vehicles/[id].tsx`): when `GET /my/vehicles/:id` returns a non-null
  `plateHistory` (other listings of the same plate have rides or reviews), a small info card reads "This car
  has history on KerayeGo — N rides, ★ 4.6 from M reviews. Reviews stay with the car's plate.", leaving out
  parts that are 0 or null (`plateHistoryText`, `features/reviews/plateHistory.ts`).
- **Identity hold** (`features/identity/`): when a phone number matches a blocked person the backend puts
  the account on hold — `GET /users/me` (and the login `user`) carry `identityHold: true`, and booking,
  posting a trip, requesting seats and starting a trip answer 403 `IDENTITY_ON_HOLD`. `useIdentityHold`
  reads `/users/me` under the shared `['me']` query key (so a number verified in Profile & settings,
  which writes `['me']`, refreshes it),
  and `IdentityHoldBanner` shows the hold message on the account tab (`(tabs)/profile.tsx`), the
  post-trip screen (`my-trips/new.tsx`), and the top of `InquiryFormSheet` and `TripInquiryFormSheet`.
  When one of those submits gets 403 `IDENTITY_ON_HOLD`, the server's message is shown in the banner
  (in the sheets, next to the buttons) instead of a plain error, and `['me']` is refetched. Submit is
  never disabled by the flag: the server decides. Starting a trip in the driver cockpit shows the
  server's message through its existing action error.

### 10.1 Day-of trip execution (web has only a partial port — see `docs/FEATURE_MAP.md`)

`account/my-trips/[id].tsx` (driver) and `account/trip-request/[id].tsx` (rider) are the two live
routes, both backed by the offline queue (§11). Each route file itself is now a thin composition layer;
the actual state machines and rendering live in per-role hook/component folders:

- **Driver** — `features/trips/driverCockpit/`:
  - `useDriverLocationWatch`: GPS watch + emit.
  - `useDriverStopProgress`: manifest merge plus the leg state from `legState.ts`.
  - `useLegRoute`: the current leg's route line and live ETA, from `routeProgress.ts`.
  - `useAutoArrival`: automatic arrival.
  - `useDriverTripActions`: start/end plus pickup/dropoff/no-show/arrived/departed, with
    offline-queue fallback; cancel is a plain mutation (no queue). **End ride** first flushes the queue
    (`flushNow`); if actions still won't send it warns and the button becomes **End anyway**.
  - `useDriverChatInbox`: per-rider unread counts.
  - Rendering: `DriverPostedTripView` (pre-trip), and `DriverLiveCockpit` + `LegPanel` (live). The live
    view's Route/Riders/Details sheets use `RouteOverview`, `RidersTab`/`RiderCard` and `DetailsTab`.
  - `useRiderLocationPins` (+ pure `riderLocations.ts`): riders' shared positions from
    `GET /my/trips/:id/rider-locations`, polled every 10 s in the foreground only while a rider still
    waits for pickup and the trip is `IN_PROGRESS`, or `ACTIVE` from 30 min before to 3 h after departure.
    The live cockpit draws them as person pins ("Sara · 3 min ago", `LiveTripMap`'s `riderPins`); the
    pre-trip view, which has no map, lists them in `SharedRiderLocationsCard` with a Map link.
- **Rider** — `features/trip-inquiries/riderLiveTrip/`: `useRiderLiveRoute` (own GPS fix, incoming
  driver location, whole-route fetch, ETA throttled to once per 45 s per target stop),
  `useRiderTripActions` (self-reported arrived/dropoff with the same offline-queue fallback; cancel is a
  plain mutation), rendered by `RiderPreLiveView` (pre-trip) and `RiderLiveView` + its
  `StopsTab`/`DriverTab`/`SummaryTab` (live). Pure state lives in `riderTripState.ts` (seat stages, ride
  phases, copy), `rideActionAvailability.ts` (when Complete is allowed — a drop-off stop with no
  coordinates allows completing anywhere) and `routeStops.ts`; cards include `PreTripConfirmationCard`
  (departure countdown), `SeatOutcomeCard` (a no-show rider keeps chat only while the trip runs),
  `RiderConfirmSheet`, `DriverArrivedAgo` and `DriverContactActions` (Chat / Call `tel:` / WhatsApp). Both show the rider's own "Sharing
  your location with your driver" card (`CustomerLocationSharingCard` — a card pre-trip, a strip under
  the ride header live) while the seat's sharing window is open (§12).
- Both roles' offline-queue-fallback actions share one `runTripAction` helper
  (`features/trips/offlineSync.ts`); both roles' socket-room join/leave and hardware-back-button lock
  share `useTripRoomPresence`/`useBlockBackButtonWhileActive` (`features/liveRide/`).

**Driver**: pre-trip view (Start trip behind a "Not yet / Start trip" confirm, Cancel trip, inline
"Incoming requests" card — shown only while
`trip.status === ACTIVE && !effectiveInProgress`) → **Start trip** → the live cockpit, which goes
**leg by leg**.

`legState.ts` (`deriveLegState`, a pure mirror of the backend's `findCurrentStopId`) walks the
manifest's `routeStops` in visit order (pickups, then drop-offs). Each stop goes
upcoming → current → done. A stop the driver never arrived at whose riders are all resolved already
(cancelled, dropped off early, no-show at pickup) is skipped automatically. The current stop's phase
drives everything on screen:

- **Navigating:**
  - The map shows the driver, the current stop, the route line between them, and any riders' shared
    positions (`riderPins`). There's no card over it.
  - `useLegRoute` fetches `/geo/route-directions` once per leg, and again only when the driver is
    >75 m off the line, at most every 30 s. Between fetches, `routeProgress.ts` trims the driven part
    of the line and recomputes the remaining distance and ETA from each GPS fix.
  - The camera frames the driver and the stop and follows them; panning shows a Re-center button.
  - `LegPanel` shows the stop, its riders (with chat), **Navigate** (Google Maps hand-off) and
    **Arrived** (enabled within 100 m).
  - `useAutoArrival` also sends the arrival on its own once the driver has stayed within 50 m for 15 s,
    on a fix accurate to ≤50 m (owner decision). It uses a timer rather than waiting for fixes, because
    a parked phone stops reporting new ones. The `ARRIVED` payload carries `trigger: 'manual' | 'auto'`.
- **At stop:**
  - Navigation pauses: no route line, and the map centres on the stop.
  - The panel becomes a checklist of that stop's riders: **Picked up** / no-show at a pickup,
    **Dropped off** at a drop-off. `StopWaitTimer` shows "Waiting m:ss" at a pickup on the server's
    clock (`ServerClock`, `noShow.ts`). `NoShowControl` (exported from `RiderCard.tsx`) stays hidden
    until the server has the arrival (it says so while the arrival is still queued), then counts down
    "No-show in m:ss" (5 minutes) and opens a "Mark <name> as a no-show?" sheet; "They turned up — picked
    up" reverses a no-show by sending `PICKUP`. On a backend without `serverNow` the action is hidden.
  - **Start next leg** (a `DEPARTED` event; see `docs/API_CONTRACTS.md`) stays disabled until every
    rider is verified. At the last stop it's **End ride** instead.
- **Done:** End ride.

The whole route (`RouteOverview`), every rider (`RidersTab`, for out-of-order actions such as an early
drop-off), and trip details are sheets off the panel. The Riders sheet still lists no-show riders (with
a "No-show" badge) but offers no no-show *action* — those are marked at the stop. **End ride** stays reachable from the panel throughout and transitions the trip to
`COMPLETED`; its confirmation copy says any rider not yet tapped will be auto-resolved server-side
(`PickupSource.AUTO_ON_TRIP_END`).

The hardware back button **and** the native header's back chevron/swipe gesture are both suppressed
while in progress (`Stack.Screen` `headerShown`/`gestureEnabled` toggled off in the route file itself).

Once the ride has ended, or when a completed trip is reopened later, `DriverRideSummary` replaces the
cockpit full screen: no map, no header, no chat. It shows:

- **Stats:** riders completed, seats travelled, no-shows, and estimated earnings in the trip's own
  currency (`currencyForMarket(userVehicle.country)`). Ending the ride completes every rider who isn't
  a no-show (`AUTO_ON_TRIP_END`), so every rider is either completed or a no-show (`rideSummary.ts`).
- **Riders:** each rider with their outcome (completed / no-show).
- **Rate your riders:** once the server has the trip `COMPLETED`, a "Rate your riders" `RateSheet` opens on
  its own (the end-of-ride prompt, §9) listing every rider the server's `GET /reviews/my/eligible`
  `tripsAsDriver` still has for this `trip.id` (accepted, not a no-show, past the scheduled departure, not
  rated before; riders this device marked a no-show since are dropped too). Each rider gets stars and an
  optional private note and is its own `TRIP_INQUIRY` POST; rating only some is fine. A "Rate your riders"
  card stays above the stats until every rider is rated. If End is still waiting in the offline queue, the
  summary says rating opens once the end has synced — the card and the sheet appear once the server has
  the trip completed and the eligible list includes it.
- **Close:** `router.dismissTo('/')` returns to the home tabs.

**Rider**: pre-trip status/cancel view → once `ACCEPTED` and the trip goes `IN_PROGRESS`, a tabbed
Stops/Driver/Summary live view with self-reported arrival/completion (same 100m geofence pattern; the
rider's drop-off button is **Reached**, which opens a "Complete your ride?" sheet) and Chat / Call
(`tel:`) / WhatsApp. While the ride is locked (stage `live`), the route file hides the header and turns
off the swipe-back gesture (`headerShown`/`gestureEnabled: !rideLocked`, taking the top safe-area edge
itself) **and** blocks the hardware back button — the same lock as the driver's screen.
Once the rider's ride is over (stage `droppedOff` or `tripCompleted`), the scrolling `RiderPreLiveView`
shows the outcome card and, while `tripsAsRider` still lists the seat, a **Rate your trip** card; the
rating sheet (driver + car per `riderTripRating`) opens on its own once (end-of-ride prompt, §9), never
over the drop-off confirm, the chat or a chat-link notice. The live view's Summary tab is gone by then
(the live view only shows while the ride is locked), so the prompt lives on the post-ride view.

## 11. Offline Trip Action Queue

`features/trips/offlineSync.ts` + `storage/offline-trip-queue.ts` (AsyncStorage key `trips.offlineQueue`).

**Storage**: one list, but every item is stamped `v: 2` with its `userId` and `tripId`, and every read is
per user (and trip) — `AuthProvider` sets the owner (`setOfflineQueueOwner`) on sign-in/bootstrap and
clears it on sign-out, which also stops a flush still running. Queued actions survive logout and session
expiry and replay only once the same user signs back in; items written before owners existed are adopted
by the first signed-in user who reads the queue. **Retention** (owner decision): an action is discarded
after 24 h unsynced or 20 counted failed attempts — an attempt only counts once its backoff has passed
(15 s, doubling, capped at 1 h), so a phone that's simply offline spends its 20 over ~12 h. Discarded
actions go to `trips.offlineQueue.dropped` (kept 7 days, ≤50 entries), which the trip screen's
`OfflineQueueNotice` shows as a dismissible notice even when the drop happened elsewhere. Writes take a
storage lock and notify change listeners.

**Flushing** — foreground only, never in the background (the app's only background work is the two
location tasks, §12, which don't touch this queue):
- `useGlobalOfflineQueueFlush(userId)`, mounted once in the root layout: flushes **every trip** the
  signed-in user has queued on mount, on `AppState` → `active`, and every 15 s — wherever they are in the
  app, not just on that trip's screen.
- `useOfflineTripQueue(tripId, userId)` (the trip screens): flushes that trip on mount and right after
  each enqueue, and exposes the pending count and dropped-action notice (`droppedActions`/`dismissDropped`).
- `flushTripQueue` is single-flight per trip with a re-run if more arrives mid-flush. After a flush it
  invalidates `myTrips`, `myTrip`, `tripManifest`, `myActiveRide` and `tripInquiry`, plus the eligible-
  reviews list when an `end` was applied.

`runTripAction` (shared by `useDriverTripActions` and `useRiderTripActions`, §10.1): if anything is
already queued for the trip, the new action is **queued behind it** instead of sent (order must hold);
otherwise it tries the mutation → on a retryable failure, enqueues + runs the caller's fallback;
otherwise surfaces the error. On success it records the action as applied (`recordApplied`).
`tripActionOverlay.ts`'s `deriveTripActionOverlay` turns applied + pending actions into the optimistic
overlay the screens draw (`started`, `ended`, rider events, `noShowIds`, `arrivedStopIds`,
`departedStopIds`, `arrivedInquiryIds`; a later `PICKUP` clears an earlier `NO_SHOW`).

**Replay** is strict FIFO per trip and stops at the first action that fails with a **retryable** error
kind (`isRetryableErrorKind`: network, server, rate_limited, unauthorized, unknown), leaving it and
everything after it queued (a queued `PICKUP` must reach the server before a queued `DROPOFF` for the same
rider). On a non-retryable refusal of `start`/`end`, the queue re-fetches the trip and treats `start` as
applied if it's `IN_PROGRESS`/`COMPLETED` and `end` if `COMPLETED` (a code comment says the current
backend answers a repeat with 200 and only an older one 400s); if that status check itself fails
retryably, the action stays queued. `recordEvent` (`PICKUP`/`DROPOFF`/`ARRIVED`/`NO_SHOW`/`DEPARTED`) is
treated as idempotent by its client-generated event `id` — the client's documented assumption is that the
backend upserts by that id, not independently verified here. Any other non-retryable error (validation/
permission) drops the action as permanently failed (into the dropped log) rather than blocking the rest.

## 12. Live Ride: Real-Time Map, Location & Chat

The mobile app's signature feature. A single **module-level singleton Socket.IO connection**
(`features/liveRide/socket.ts`, `useRideSocket()` — state via `useSyncExternalStore`;
`rideSocketActions` is a stable module-level object) to the backend's `/ride` namespace. Screens never
tear it down; `disconnectRideSocket()` does, on logout and session expiry (§6), so each session gets a
fresh instance. Event handlers live in module-level `Set`s that outlive any one socket instance.

- **Connection**: `io(origin + '/ride', { transports: ['websocket'], autoConnect: false, forceNew: true,
  auth: (cb) => cb({ token: getAccessToken() }) })`, connected explicitly by `connectRideSocket()` and
  only when an access token exists. Passing `auth` as a **function** means Socket.IO re-invokes it on
  every reconnect, so a refreshed token is picked up without recreating the socket. While Socket.IO's own
  reconnection is active, a `connect_error` is left to it; when the **server** refuses or closes the
  connection (`!socket.active`, on `disconnect` or `connect_error`), the app runs **its own reconnect
  loop** (`scheduleReconnect`): jittered backoff from `reconnectBackoff.ts` (1 s doubling, 30 s cap,
  scaled to 50–100 %, reset on `ready`), reuse a token the REST interceptor already refreshed or else
  `refreshAccessToken()` (§6), then `socket.connect()`. Returning to the foreground skips a pending
  backoff.
- **`ready` is a distinct server event**, separate from Socket.IO's own `connect` — `isReady` resets to
  `false` on every `disconnect` since the server only emits `ready` once per successful handshake. Every
  join/leave/send action gates on `isReady`, not just `isConnected` (avoiding Socket.IO's buffered replay
  of stale emits).
- **Events**: `trip.join`/`trip.leave` (ack), `location.update` (emit + listen), `inquiry.join`/`leave`
  (ack), `chat.message`/`chat.typing`/`chat.read`. An 8-second ack-timeout wrapper (`withAckTimeout`)
  covers trip join/leave, inquiry join/leave and `chat.message`. `location.update` (acked, no timeout)
  and `chat.typing` are sent **volatile** (dropped rather than buffered when the transport can't take
  them).
- **Notification rooms**: `subscribeInquiryNotifications(id)` joins an inquiry's room for app-wide
  events (used only by `useLiveInquiryNotifications`, §13, for every `ACCEPTED` inquiry — so only when
  that dev bridge is switched on) and re-joins them on every `ready`; `leaveInquiry` doesn't leave these,
  and `unsubscribeInquiryNotifications` has no callers. So with the bridge on, `ChatPanel`'s "leave the
  room in the background so the server pushes instead" has no effect for an accepted inquiry.

**Location tracking** (`useDriverLocationWatch`, `features/trips/driverCockpit/`, driver only):
`Location.requestForegroundPermissionsAsync()`
→ `watchPositionAsync({accuracy: High, timeInterval: 4000, distanceInterval: 10})`, gated on
`effectiveInProgress` (trip `IN_PROGRESS`, or `ACTIVE` + a local optimistic-start flag) and on the app
being in the foreground. Each fix goes through `locationEmit.ts`'s `toLocationUpdatePayload` (speed m/s →
km/h, negative/iOS `-1` heading/speed/accuracy dropped, heading > 360 dropped, the fix's own timestamp)
and `emitLocation()`, which throttles to at most one emit per 3750 ms per trip by fix timestamp
(`isLocationEmitDue`). After a permission denial, returning to the foreground re-checks and restarts the
watch. The subscription is torn down on unmount or the moment `effectiveInProgress` goes false. This
foreground watch is the only GPS source while the app is open.

**Background location** (`features/liveRide/backgroundLocation/`, driver only). Once the server confirms
the trip `IN_PROGRESS`, the driver route (`useDriverBackgroundLocation`, called from
`app/account/my-trips/[id].tsx`) starts an
`expo-location` background task (`Location.startLocationUpdatesAsync`, task name
`kerayego.driver-location`; 10 s / 25 m, high accuracy, iOS `AutomotiveNavigation` with
`pausesUpdatesAutomatically: false`). One GPS source at a time: in the foreground the task ignores its
fixes and the watch above emits over the socket; in the background the task posts fixes over REST
(`POST /my/trips/:id/location`) in batches of up to 20, at most one request per 8 s, backing off 60 s on
a rate limit.

- **Permission and platform behavior** (owner decisions, stated in `app.config.js` and
  `driverLocationSharing.ts`): When-In-Use only, never "Allow all the time". iOS uses the background
  location mode with the blue status-bar indicator. Android runs a foreground service with a "Trip in
  progress" notification, killed with the app (`killServiceOnDestroy`), so **swiping the app away stops
  sharing**.
- **Registration**: the task executor is defined at module scope from the custom entry (`index.js` →
  `registerDriverLocationTask.ts`), so it exists even when the OS starts the app with no UI. The import
  is guarded: binaries without `expo-task-manager`'s native module (Expo Go, web, dev clients built before
  it was added) simply have no background sharing, and the cockpit's `BackgroundLocationNotice` says so.
- **Which trip**: `storage/active-driver-trip.ts` persists the trip and the driver who started sharing,
  so a different account signing in on the device never reports under the wrong session.
- **Stops** on trip end, logout or session expiry (`AuthProvider` via `setDriverLocationSessionUser`),
  the active ride going away (`useDriverLocationReconcile`, mounted in `app/_layout.tsx` — a "ride over"
  answer is trusted only if it was fetched at least `REQUEST_TIMEOUT_MS + 5 s` after sharing started),
  the OS waking the task with no session, a different signed-in user, or the location endpoint answering
  404/409 or 401/403 after refresh (`session_rejected`); a trip the server stopped is never restarted in
  that app run. The pure rules and constants live in `backgroundLocationRules.ts` (unit-tested).
  Before it registers, it stops the customer task below if that's running (`setBeforeDriverLocationStart`).

**Customer location sharing** (`features/liveRide/backgroundLocation/customerLocation*.ts`, carpool riders
and rental customers). A carpool rider's or rental customer's position reaches their driver while the
backend says a **sharing window** is open — the backend alone decides (rider: seat `ACCEPTED`, not yet
picked up / no-show / dropped off, trip `IN_PROGRESS` or `ACTIVE` within departure − 30 min … + 3 h;
rental: accepted assigned driver, not picked up, booking `IN_PROGRESS` or `ACCEPTED` within pickup − 60
min … + 3 h). A second `expo-location` task, `kerayego.customer-location`, separate from the driver's:

- **Cadence**: High accuracy (the driver has to find the person at a kerb — Balanced is a ~100 m fix),
  10 s on Android, `distanceInterval: 0` (a waiting customer stands still, and the driver stops seeing a
  position older than 15 min), iOS `ActivityType.Other` with `pausesUpdatesAutomatically: false`. It
  POSTs in the foreground **and** the background (no socket for customers) to
  `POST /trip-inquiries/:id/location` or `POST /booking-requests/:id/customer-location`, at most one
  request per 8 s, keeping up to 20 unsent fixes; 429 backs off 60 s, 5xx/offline keep the fixes, 400
  drops the batch. Foreground-service notification "Sharing your location" / "KerayeGo is sharing your
  location with your driver until pickup", `killServiceOnDestroy`, iOS blue indicator.
- **Reconcile** (`useCustomerLocationReconcile`, mounted in `app/_layout.tsx` next to the driver's):
  asks `GET /users/me/location-sharing` on every return to the foreground, every 60 s while the app is
  open, and just after `nextOpensAt`. It keeps sharing the window already shared while it's open and not
  paused, else starts the first open, non-paused one (one at a time) — **from the foreground only**, once
  "While using the app" location is allowed: before the first OS prompt the root layout shows
  `CustomerLocationPermissionSheet` (Continue / Not now; the × and a tap outside close it; a dismissed
  window isn't asked about again unprompted that run). It stops when the window is gone, paused or
  replaced, another account (or nobody) is signed in, or the driver task is sharing. The pure decisions
  live in `customerLocationRules.ts` (unit-tested).
- **Server refusals**: a 404/403/409 (`LOCATION_SHARING_CLOSED`/`LOCATION_SHARING_PAUSED`) or a 401
  after refresh stops sharing and re-asks GET; that window isn't started again for 2 min (so a window
  that just closed can't loop), unless the customer taps Resume / Try again.
- **Never both tasks**: it doesn't start while the driver task runs or a driver trip is recorded, and
  stops when the driver task starts (see above).
- **UI** (`CustomerLocationSharingCard`, wording from `customerSharingDisplay.ts`): on the rider's
  pre-trip and live views and the rental booking detail, only while that window is listed. **Stop** /
  **Resume** call `PATCH /trip-inquiries/:id/location-sharing` or
  `/booking-requests/:id/customer-location-sharing` (Stop also ends the task on this device at once);
  warnings for location off ("Turn on" re-asks, or opens Settings once the OS won't ask), a failed start
  ("Try again"), a build without `expo-task-manager`, and driving a trip; and (in the `card` variant
  only, not the live view's `bar`) a note that swiping the app away stops sharing.
- **Which window, and whose**: `storage/active-customer-share.ts`. Stops on logout/expiry like the
  driver's (`setCustomerLocationSessionUser`). The executor is registered from `index.js` →
  `registerCustomerLocationTask.ts`, guarded the same way.

**`LiveTripMap`** (`react-native-maps`, `PROVIDER_GOOGLE`): renders trip stops (numbered pins on the
driver's map, plain pins on the rider's), an optional route `Polyline`, rider pins (`riderPins`, §10.1),
an optional `driverLabel`, a "Connection lost" banner, and a driver marker. The marker's first
coordinate is set in a `useEffect` once the first fix arrives (the marker mounts only then — the code's
own comment saying "synchronously, in render" is stale). After that, **on Android** it moves via the
imperative `animateMarkerToCoordinate()` (4000 ms) — a `hasMountedDriverMarkerRef` guard avoids calling it
in the same commit the marker mounted in, which the code says reproducibly causes a NullPointerException
on Android — while **on iOS** the `coordinate` prop is simply re-set on every fix. `focus` mode frames the
given points and re-fits at most every 8 s while following; a user pan pauses following and shows a
Re-center button. Markers use `tracksViewChanges={false}`.

**Chat** (`ChatPanel` + `ChatModalSheet`, an `AppSheet` at 76 % height, `flush`): scoped to one
`tripInquiryId`. On becoming active it loads the **whole** history (`chatHistory.ts`'s
`fetchChatHistory`: `GET /trip-inquiries/:id/messages` pages of 50, oldest first, following
`meta.nextCursor` up to 100 pages with a 1 ms cursor overlap, merged by id), joins the inquiry's socket
room only while active, ready **and in the foreground** (leaving it in the background), and after every
successful join runs a catch-up fetch from the newest server `createdAt`. Every incoming event is
filtered by `tripInquiryId` client-side since the shared socket delivers every inquiry's events
app-wide. Messages are sent with a client-generated `expo-crypto` UUID that doubles as an idempotency key
(a comment states the server upserts by this id) — the optimistic local entry is reconciled in place once
the ack returns. Typing is throttled to at most once per 2.5s; the "is typing" indicator clears locally
4s after the last received event. `chat.read` is sent for the newest message from the other party while
ready and in the foreground; an incoming receipt marks every own-sent message up to and including the
referenced message's timestamp (or all unread own messages if that message isn't loaded). **Both**
roles present chat via `ChatModalSheet` (driver: `DriverLiveCockpit`; rider: `RiderLiveView` and
`RiderPreLiveView`) — `ChatPanel.tsx`'s own header comment describing it as "embedded as a tab" on the
rider's screen is **stale**.

**Geo/Places**: `LocationField`/`LocationMapSheet` (address entry, autocomplete, map-pin picker) and
`NearMeControl` (the near-me button on the Vehicles/Providers tabs). `LocationField` and the map picker's search box share
`usePlaceSearch` (300ms-debounced autocomplete, one Places session token per search, stale responses
dropped). The picker (`LocationMapSheet`, opened by "Choose on map") is a **fixed centre pin**: the user
moves the map under it rather than tapping to drop a marker, and the picked spot is always the map
centre. It has a Places search box floating over the top of the map, and bottom-right current-location
and +/− zoom buttons (zoom keeps the centre fixed). It opens on the field's existing coordinates if it
has any; otherwise on the user's last known position, but only if location permission was **already**
granted (it never prompts on open), and failing that on a country-wide view. Confirm stays disabled until
the map is zoomed to roughly neighbourhood level (`latitudeDelta` ≤ 0.1). The centre is reverse geocoded
400ms after the map settles, skipped when zoomed out or when the address is already known (the field's
own text or a search result's). A failed lookup still lets the spot be confirmed, just without a label.
All picker state resets on every open because `Modal` unmounts its children while hidden. All four Google-backed lookups
(`reverseGeocode`/`autocompletePlaces`/`getPlaceDetails`/`getRouteDirections`) are **proxied through the
backend's `/geo/*` endpoints** rather than calling Google directly from the device — a code comment
explains mobile's own `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is Maps-SDK-only (for rendering map tiles via
`react-native-maps`), not scoped for Places/Geocoding. The rider's live ETA recompute is throttled to at
most once per 45 seconds even though the driver's position arrives roughly every 4 seconds, to bound API
cost; a failed/absent route response is treated as "no overlay to show," never blocking.

## 13. Push Notifications

`features/notifications/` + `api/device-tokens.api.ts` (`POST /device-tokens { token, platform }`,
`DELETE /device-tokens { token }`).

**Tokens** (`pushToken.ts`). Foreground notification presentation is configured once at module load
(`configureNotificationHandler`: banner + list + sound + badge). The token is registered on bootstrap
and on every sign-in, re-registered on rotation (`subscribePushTokenRefresh`, root layout, signed-in
only), unregistered before logout, and on session expiry or account deletion `invalidateDevicePushToken()`
deletes it natively with no backend call (`registerPushToken` waits up to 10 s for a pending
invalidation). `registerPushToken()`/`unregisterPushToken()`/`subscribePushTokenRefresh()` are all
best-effort — every failure (permission denial, fetch error, network error) is caught and only
`console.warn`'d, never surfaced to the UI or blocking login/logout/app-start.

**The app registers the native platform push token** — `Notifications.getDevicePushTokenAsync()` (an FCM
registration token on Android, an APNs device token on iOS) — **not** the Expo push token
(`getExpoPushTokenAsync()` is never called anywhere). The backend sends everything through FCM
(`firebase-admin` `sendEachForMulticast`), which accepts the Android token but **rejects the iOS APNs
token** — the backend then prunes it as dead, so **iOS devices never receive pushes today**. The
platform value sent is a plain `'ANDROID' | 'IOS'` string, matching the backend's `DevicePlatform` Prisma
enum, but the backend doesn't use it to route.

If notification permission is not currently granted at logout time, `unregisterPushToken()` silently
skips the backend `DELETE` call entirely — a token registered while permission was granted, then revoked
without an intervening logout, has no compensating cleanup path anywhere in this codebase.

**Taps** — `pushTapInbox.ts` + `usePushTapNavigation.ts` + pure `pushRouting.ts` (unit-tested):
- `startPushTapCapture()` (root layout, module scope) captures taps — including the one that launched
  the app — into an inbox: newest tap wins, deduplicated by request id (last 20), taps older than 10 min
  dropped, `clearLastNotificationResponse` called. A tap that arrives while signed out waits for sign-in.
- `usePushTapNavigation` routes the held tap once the session is restored, a user is signed in, they're
  not on an `(auth)` screen, and the navigator is ready. A push whose `recipientUserId` isn't the signed-in
  user (a stale token) is ignored. `pushNavigationStep`: during an active ride, taps for any other screen
  do nothing; a tap for the screen already open updates its params instead of pushing.
- **Where a tap goes** (`resolvePushTarget`):
  - Ride pushes (`RidePushType`: `tripInquiry.created`/`accepted`/`rejected`/`cancelled`/
    `riderCancelled`, `chat_message`, `trip.started`/`driverArrived`/`droppedOff`/`riderNoShow`/
    `nextPickupApproaching`/`completed`/`shareLocation`) are **role-aware** via the payload's
    `recipientRole` (relative to the trip, not `User.role`): `DRIVER` → `/account/my-trips/:tripId` (a chat
    adds `?chatInquiryId=`; with no `tripId` the inquiry is looked up), `RIDER` →
    `/account/trip-request/:inquiryId` (a chat adds `?openChat=1`). Legacy payloads with no role:
    rider-only types → the rider screen, driver-only types with a `tripId` → the driver screen, anything
    else → `GET /trip-inquiries/:id` (`retry: false`; on not_found/forbidden/unauthorized stay put,
    other errors fall back to the rider screen).
  - `userVehicle.approved`/`rejected`/`suspended`/`reactivated` → `/account/my-vehicles/:userVehicleId`.
  - Rental bookings (2026-10-30, this app only): `booking.statusChanged` (the business contacted /
    accepted / declined / cancelled / started / completed it), `booking.jobStarted` ("Your driver is on
    the way"), `booking.jobCompleted` (rate the car and driver), and the reminder `booking.shareLocation`
    (2026-11-01, sharing window opened) → `/account/inquiry/:bookingId`.
  - Anything else (unknown types, missing ids) → no navigation.
- `chatDeepLink.ts` + `useChatDeepLink.ts` open the linked chat on `my-trips/[id]` / `trip-request/[id]`
  from those params (one-shot), or explain why not in `ChatLinkUnavailableSheet` ("Chat isn't open").
- `usePushReceivedInvalidation`: a push received in the foreground invalidates the keys
  `pushInvalidationKeys` returns — e.g. `['booking', id]` + `['myInquiries']` for bookings,
  `['userVehicles']` for vehicle decisions, and the open sharing windows (`['myLocationSharing']`) for
  both `shareLocation` reminders.

**`useLiveInquiryNotifications`** (root layout) — a **developer aid, off by default** (2026-11-09):
it does nothing unless `EXPO_PUBLIC_LOCAL_PUSH_BRIDGE=true` (`constants/config.ts`'s
`LOCAL_PUSH_BRIDGE_ENABLED`). It's for a simulator or device that gets no real pushes; the backend
already sends a real push for every event below, so turning it on where pushes arrive shows each
notification twice (nothing deduplicates them). When on, for the signed-in user it connects the ride
socket, joins every `ACCEPTED` inquiry's room (`subscribeInquiryNotifications`, §12), and every 10 s polls
`GET /my/trip-inquiries?limit=10`, `GET /trip-inquiries` (page 1, limit 10) and the first page of
messages per accepted inquiry (so a chat past 50 messages is only covered by the socket), firing
**local** notifications (`scheduleNotificationAsync`: "New seat request", "Seat request accepted!",
"Seat request declined", "Trip started!", "Trip completed", "New message") with push-shaped `data`, so
a tap routes like a real push. It is a plain `setInterval` — foreground only.

**Testing taps on an iOS simulator**: `npm run test:push` / `test:push:chat` / `test:push:trip` send
`scripts/push/test-push.apns` (`tripInquiry.accepted`), `test-chat.apns` (`chat_message`) and
`test-trip.apns` (`trip.started`), all as `recipientRole: RIDER` with no `recipientUserId` (so they route
for whoever is signed in) and `REPLACE_WITH_…` ids to swap for real ones. On iOS, expo-notifications
exposes a remote notification's data as the payload's **top-level `"body"` object** (its
`serializedNotificationData`), so that's where the push data sits; `pushTestPayloads.test.ts` checks
each file routes to the rider screen. (Real pushes from the backend's FCM sender put their data at the
top level instead, which on iOS would reach the app without data — a second reason, beyond the token
issue above, that iOS push doesn't work today.)

## 14. Media Uploads

`features/media/useImagePicker.ts` (`pickAndUploadImage`) + `api/media.api.ts`. Requests photo-library
permission **lazily**, only when the user initiates a pick (not proactively at app start). Uses
`expo-image-picker`'s `launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 })` — images only,
fixed compression, single-select (no `allowsMultipleSelection` passed; the code only ever reads
`assets[0]`). There is no document picker: verification documents are photos too.

`mediaApi.upload(file, context, documentType?, entityId?, onProgress?)` → `POST /media/upload?context=…`
(`&documentType=`, `&entityId=` when given). `UploadContext` is `'document' | 'trip_document' |
'user_vehicle_photo'`; the only callers are the personal-vehicle form's `DocumentUploadField`
(`trip_document`) and `VehiclePhotosField` (`user_vehicle_photo`), both passing the vehicle's
client-generated id as `entityId` (§10). A document upload's `UploadResult` carries `previewUrl` — a
10-minute signed link, since `url` points into the **private** bucket and never opens by itself.
There is no media delete call in the app (and, since 2026-11-09, no unused `DOCUMENT_TYPES` label list).

**Unlike the push-token functions, media upload has no error swallowing at all** — `mediaApi.upload()`
and `pickAndUploadImage()` contain no try/catch; a failure rejects/throws normally to whatever calls
them. There is **no client-side file-size or MIME-type validation** beyond the picker's own `mediaTypes`
option — the same gap found on `kerayego-web`'s upload components. `mediaApi.upload()` builds a React
Native `FormData` request, explicitly overriding the shared axios client's default
`Content-Type: application/json` header with `multipart/form-data` for this one call (no explicit
boundary parameter — whether the RN networking layer still generates one correctly when the header is
set explicitly rather than left to auto-detection was not verified in this pass).

## 15. Environment & Configuration

`.env.example`:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Backend base URL. Platform-specific guidance in the file's own comments: Android emulator → `http://10.0.2.2:3001/v1` (this is also the hardcoded fallback in `constants/config.ts`); iOS simulator → `http://localhost:3001/v1`; physical device → the host machine's LAN IP. |
| `EXPO_PUBLIC_APP_ENV` | `development`\|`staging`\|`production`; drives `IS_DEV` in `constants/config.ts`. |
| `EXPO_PUBLIC_LOCAL_PUSH_BRIDGE` | Developer aid, default off; only the exact string `true` turns on `useLiveInquiryNotifications`'s local fake notifications (§13). Leave off wherever real pushes arrive, or every notification shows twice. |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Wired into `app.config.js` as both `ios.config.googleMapsApiKey` and `android.config.googleMaps.apiKey` — a Maps-SDK-only (tile-rendering) key, distinct from and not used by the `/geo/*` proxy calls (§12), which use the backend's own server-side key. |

`REQUEST_TIMEOUT_MS = 30000` is a hardcoded constant in `constants/config.ts`, not env-driven.

## 16. Android/iOS Native Configuration

- **Package/bundle identity**: `com.kerayego.app` on both platforms (`app.config.js`'s
  `ios.bundleIdentifier`/`android.package`, `android/app/build.gradle`'s `namespace`/`applicationId`,
  and `google-services.json`'s `package_name` — but see Firebase below). App name `KerayeGo`, slug
  `kerayego-mobile`, version `1.0.0`, portrait only, `userInterfaceStyle: 'automatic'`. The URL
  **scheme is still `rentalmobile`** (the old name), and `android.usesCleartextTraffic: true` (plain-HTTP
  dev backends). iOS entitlement `aps-environment: 'production'`.
- **New Architecture + Hermes**: both enabled (`android/gradle.properties`: `newArchEnabled=true`,
  `hermesEnabled=true`). `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`.
  `edgeToEdgeEnabled=true`. No JDK override (`org.gradle.java.home`) is set in the current generated
  `gradle.properties`; `android/` is regenerated via `expo prebuild`, so any local tweak there is lost.
- **`android/` and `ios/` are both gitignored** ("generated native folders" per `.gitignore`'s own
  comment). **No `ios/` directory exists anywhere in this checkout.** No `eas.json` exists anywhere in
  this repo or its parent workspace — no EAS Build/Submit profile is committed. Implication: Android is
  currently built via a locally-run `expo prebuild`/`expo run:android`; iOS has never been locally
  prebuilt on this machine and would need either a Mac running `expo run:ios` or an EAS cloud build
  configured entirely outside this repo.
- **Signing**: both `debug` and `release` build types point at the same `signingConfigs.debug` (the
  debug keystore) — release builds are **not** signed with a production keystore in this repo.
- **Minification**: `android.enableMinifyInReleaseBuilds`/`enableShrinkResourcesInReleaseBuilds` are not
  set anywhere in `gradle.properties`, so both default to **false** — release builds are currently
  unminified/unshrunk unless overridden at build time.
- **Firebase/FCM**: `google-services.json` (byte-identical copies at repo root and `android/app/`)
  points to Firebase project `rentalmarketplave` (project number 155868589460). Its `oauth_client` array
  is empty in both copies — this config only wires up FCM/push registration, not Google Sign-In.
  It is the same project the backend sends from (verified 2026-10-27), but Firebase has this app
  registered as **`com.rentalmobile.app`** (the old package): the file was first committed with that
  package and later hand-edited to `com.kerayego.app`, and works only because the Firebase-created API
  key has no package restriction. There is no Firebase iOS app (§13).
- **Expo plugins** (`app.config.js`): `expo-router`, `expo-splash-screen` (background `#FFF7F3`),
  `expo-secure-store`, `@react-native-community/datetimepicker`, `expo-location` (When-In-Use
  permission string only; `isIosBackgroundLocationEnabled: true` adds iOS's `location` background mode;
  `isAndroidForegroundServiceEnabled: true` adds the foreground-service permissions the "Trip in
  progress" and "Sharing your location" services need on Android 14+, which require a Play Console foreground-service declaration;
  `isAndroidBackgroundLocationEnabled: false`, so never `ACCESS_BACKGROUND_LOCATION`; see §12),
  `expo-notifications` (custom monochrome icon + `#FF4E64` color, reusing the same
  asset as the Android adaptive icon's monochrome layer).
  `android.predictiveBackGestureEnabled: false` explicitly opts out of Android's predictive back gesture.
- **`expo-dev-client`** is a direct dependency; combined with native modules with no Expo Go support
  (`react-native-maps`, `react-native-reanimated` 4 + worklets, `socket.io-client`, FCM wiring via
  `google-services.json`), this app is understood to require a custom development client build rather
  than the plain Expo Go app — this is a well-supported inference from the dependency set, not a fact
  literally stated in any file read.

## 17. Build Process

```
npm start          # expo start
npm run android     # expo run:android (builds/launches the local dev client)
npm run ios         # expo run:ios (requires a Mac; would prebuild ios/ on demand — not present here)
npm run web         # expo start --web
npm run lint        # expo lint (eslint-config-expo flat config)
npm run type-check  # tsc --noEmit (tsconfig excludes example/)
npm test            # jest (§18)
npm run test:push        # iOS simulator only — see below
npm run test:push:chat
npm run test:push:trip
```

The three `test:push*` scripts run `xcrun simctl push booted com.kerayego.app scripts/push/test-*.apns`
— they need a Mac with a booted iOS simulator running the app. The payloads and how to adapt them are
in §13. (The old `reset-project` script is gone from `package.json`; `example/scripts/reset-project.js`
is just part of the leftover template.)

There is no `app.json` at the repo root (only an unrelated one inside `node_modules/@expo/log-box`) —
`app.config.js` is the sole, unambiguous Expo config source.

## 18. Testing

**Unit tests run with Jest** (`npm test`). `jest.config.js` uses the `jest-expo` preset, crawls only
`src/`, and matches `**/*.test.ts?(x)`; `jest.setup.ts` holds shared mocks. 58 test files exist, covering
pure logic and modules such as the API client and errors, storage, enums, the phone sign-in flow and auth schemas, number/date utilities and the
driver's and customer's background location rules and senders. Keep test files out of `src/app/`, where Expo Router would treat
them as routes.

- **Version pin**: `jest-expo` 57.0.4 + `@react-native/jest-preset` 0.86.2 match `react-native` 0.86.2;
  bump all three together (the config's own comment explains why).
- Test files import `describe`/`it`/`expect`/`jest` from `@jest/globals` rather than relying on ambient
  globals (TypeScript 6 no longer auto-includes `@types` packages).
- **Not covered**: no component/screen rendering tests (`@testing-library/react-native` isn't
  installed) and no end-to-end tests (no Detox/Maestro). Behavior still has to be checked by running the
  app against a live backend.
- **Known hang (2026-10-27)**: `src/features/trips/offlineSync.test.ts` never finishes (killed after
  60 s, no output), so a full `npm test` never ends. Every other file passes
  (`npx jest --testPathIgnorePatterns offlineSync`: 57 files, 1,023 tests on 2026-11-12; the hang was
  re-confirmed on 2026-11-09 — still no output after 120 s). Cause not
  investigated yet.

## 19. Consolidated Known Issues, Discrepancies & Unknowns

- **Unresolved source contradiction**: whether `PROVIDER`-role accounts use this app at all —
  `EligibleReviewsList.tsx` ("mobile has no provider role") vs. `account/_layout.tsx` ("USER and PROVIDER
  both use this group"). `auth-guards.ts`'s comment ("an account that happens to hold role PROVIDER …
  still just gets the normal user experience here") sides with the layout; phone sign-up only ever
  creates `USER`. Neither file could be determined as authoritative from source alone.
- **Fixed 2026-11-09** (kept here so nobody re-introduces them):
  - `useLiveInquiryNotifications` duplicated every real push for every signed-in user — now off unless
    `EXPO_PUBLIC_LOCAL_PUSH_BRIDGE=true` (§13); its two dead invalidation keys now point at real queries.
  - An offline app start signed the user out — the stored session is now kept and the restore retried
    (§6).
  - Trip times used two time zones — every trip time is now Pakistan time, posting included (§10).
  - The `test:push*` payload files didn't exist — now in `scripts/push/` (§13, §17); `npm run
    type-check` added.
  - Unused code removed: `ResultsMap`, `media.api.ts`'s `DOCUMENT_TYPES`, `useFeaturedVehicles`/
    `useListings` + `listingsApi.getFeatured`, `useUpdateTrip` + `tripsApi.update`,
    `useMyTripInquiryCounts`/`useTripInquiryInboxCounts` + their two counts calls.
- **Remaining unused export**: `unsubscribeInquiryNotifications` (socket.ts), the counterpart of the
  still-used `subscribeInquiryNotifications`. `tripPosterActions` lists `'edit'` though nothing renders it.
- **Rental request redesign (2026-11-12) — open points**:
  - The app sends only the **new request shape**; the backend still accepts the old one until it's told
    the app shipped (plan §3c order step 4 — tell the backend chat once this build is out). Installed
    older builds still send the old shape, and since 2026-11-11 the backend refuses some of what they
    send (6 h × 2, 7+ days, a past time).
  - Not built in the sheet: a **note per stop** (the API takes `note`; the request's message is the only
    free text); "Plate checked by KerayeGo" (A87 — the listing doesn't say); a map of the stops on the
    booking detail.
  - Tried only in unit tests, type-check and an Android bundle build — not yet on a device against a
    backend that has the 2026-11-11 changes (they weren't deployed on 2026-11-12).
- **`userBookingActions()` and similar mobile-only action-gating helpers hardcode narrower results**
  than the mirrored backend transition tables (`BOOKING_TRANSITIONS`, etc.) technically allow — e.g. a
  `USER` can in principle move a `PENDING` booking to `CONTACTED`/`REJECTED` per the table, but the
  mobile UI only ever exposes `CANCELLED`.
- **"Document type" lists**: `enums.ts`'s `DocumentType` (10 values) and `UserVehicleDocumentType` (the
  4 a personal vehicle carries — `ID_DOCUMENT_FRONT`/`BACK`, `DRIVING_LICENSE`, `VEHICLE_REGISTRATION` —
  all in `DocumentType`). Use `USER_VEHICLE_DOCUMENT_TYPES` (`userVehicleDraft.ts`) for the vehicle form.
- **Stale code comments** (the code is right, the comment isn't): `ChatPanel.tsx`'s header (tab-embedding
  on the rider's screen — both roles use `ChatModalSheet`); `LiveTripMap.tsx`'s "set synchronously, in
  render"; `useTripRoomPresence.ts`/
  `useDriverChatInbox.ts` saying `useRideSocket()`'s functions change every render (they're stable);
  `listings.api.ts`'s "city and near-me mutually exclusive in the UI"; `RatingStars.tsx`'s "no icon
  dependency"; the `user-vehicles/{id}/…` upload-path comments in `user-vehicles.api.ts`,
  `UserVehicleForm.tsx` and `VehiclePhotosField.tsx` (the backend uses `users/{userId}/vehicles/{vehicleId}/`).
- `Content-Type: multipart/form-data` set without an explicit boundary parameter is left unverified as a
  working detail (§14).
- **Background location needs a new enough binary** — dev clients built before `expo-task-manager`
  was added have no background sharing, driver's or customer's (§12). The offline queue still never flushes in the background
  (§11).
- **Production readiness gaps in native config**: release Android builds sign with the debug keystore
  and have minification/shrinking off by default; no `ios/` project or `eas.json` exists anywhere in
  this repo, so iOS build/distribution configuration lives entirely outside this checkout (if it exists
  at all).
- **No client-side file-size/MIME validation** on media uploads, and upload errors are not caught
  anywhere in the upload call chain (unlike push-token operations, which are all best-effort).
- **Tests are unit-only** — no component rendering or end-to-end tests (§18).
- **Not independently verified from these files** (relayed from in-file comments only, flagged as such
  where they appear above): the claim that mobile's validation rules exactly mirror backend
  DTOs; that `recordEvent`'s client-generated id is truly treated as an idempotency key server-side —
  both rest on client-side comments about a separate, out-of-scope NestJS backend, not on reading that
  backend in this pass. (The Firebase project match was verified on 2026-10-27, §16.)
- **iOS push doesn't work**: the iOS build registers an APNs token, which the backend's FCM sender
  rejects and prunes as dead (§13).
