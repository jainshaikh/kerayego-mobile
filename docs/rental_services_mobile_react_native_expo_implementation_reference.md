# Rental Services Mobile Application — React Native / Expo Implementation Reference

> **Status:** Approved mobile implementation direction  
> **Project stage:** Web frontend and backend are already completed; mobile application is the next client to build.  
> **Primary audience:** AI coding agents and developers continuing implementation.  
> **Original product reference:** `rental_car_phase1_reference(1).md`  
> **This document's purpose:** Remove architectural ambiguity and define what the mobile implementation should do next.

---

# 1. Executive Decision

The mobile application will be built as a **React Native application using Expo**, specifically:

- **Expo SDK 57**
- **React Native 0.86**
- **React 19.2.3**
- **TypeScript**
- **Expo Router**
- **Expo Development Builds**
- **Node.js 24 LTS** for local development and CI where compatible
- **TanStack Query** for server state
- **React Hook Form + Zod** for forms and validation
- **Secure device storage** for authentication credentials/tokens
- Existing **NestJS REST API**
- Existing **PostgreSQL + Prisma** backend/database

The project will **not** start as a bare React Native Community CLI application.

The project will **not** rely on Expo Go as its long-term development environment.

The project will use **Expo Development Builds**, which means the application remains capable of using native modules and custom native configuration when required.

---

# 2. Authoritative Context

The existing project already has:

- a public web frontend
- a user-facing web experience
- a provider dashboard
- an admin dashboard
- a NestJS backend
- PostgreSQL
- Prisma
- JWT authentication
- refresh token support
- role-based access control
- vehicle listings
- provider profiles
- saved vehicles
- booking/inquiry requests
- file/image/document uploads
- approval workflows
- notifications
- audit logs

The original Phase 1 product goal is the marketplace and inquiry layer.

The existing backend remains the **single source of truth**.

The mobile application is a **new client of the existing backend**, not a new platform or a duplicate backend.

If this document and an implementation detail in the existing backend conflict, the implementation agent must inspect the backend contract before changing anything.

Do not redesign the backend merely to make the mobile implementation easier unless a real API gap is found.

---

# 3. Product Intent

The rental platform currently supports these major roles:

1. End User / Customer
2. Rental Service Provider
3. Admin
4. Super Admin

The mobile application should initially prioritize:

- public/customer experience
- authenticated customer experience
- provider experience

The existing web application should remain the main interface for:

- Admin
- Super Admin
- complex moderation
- audit-log review
- global settings
- platform configuration
- high-density administrative tables
- operational back-office workflows

Do **not** automatically duplicate every web dashboard screen in the mobile application.

---

# 4. Mobile Phase 1 Scope

## 4.1 Public / Customer Features

The initial customer-facing application should support:

- browse vehicles
- search vehicles
- filter vehicles
- sort results
- open vehicle details
- view image galleries
- view vehicle specifications
- view features
- view provider/showroom information
- view provider profile
- save/favorite vehicles
- create an account
- log in
- log out
- email verification flow when applicable
- forgot password
- reset password
- submit a booking inquiry/request
- view personal inquiries
- view inquiry status
- view inquiry history
- manage personal profile
- remove saved vehicles

## 4.2 Provider Features

The provider mobile experience should support, as appropriate to the existing API:

- provider authentication
- provider dashboard summary
- provider profile
- verification status
- provider vehicle list
- add vehicle
- edit vehicle
- upload vehicle images
- view vehicle status
- view vehicle approval status
- view incoming inquiries
- open inquiry detail
- update inquiry status
- accept/reject/contact workflow
- provider notes if supported by the backend
- availability/pricing notes if supported by the backend
- provider notifications

## 4.3 Explicit Non-Priorities for Initial Mobile Release

Do not prioritize these unless the project owner explicitly requests them:

- full Admin dashboard
- full Super Admin dashboard
- audit-log management
- platform settings
- staff management
- advanced accounting
- invoices
- online payments
- escrow
- automated booking confirmation
- cancellation/refund engine
- telematics
- driver tracking
- white-label portals
- multi-tenant admin controls
- advanced recommendation engine

These can be added later without changing the core mobile architecture.

---

# 5. Architecture

The expected system remains:

```text
                         ┌─────────────────────┐
                         │     PostgreSQL      │
                         └──────────┬──────────┘
                                    │
                               Prisma ORM
                                    │
                         ┌──────────▼──────────┐
                         │      NestJS API     │
                         │                    │
                         │ Auth               │
                         │ Users              │
                         │ Providers          │
                         │ Vehicles           │
                         │ Listings/Search    │
                         │ Booking Requests   │
                         │ Media              │
                         │ Notifications      │
                         │ Admin              │
                         │ Audit Logs         │
                         └────────┬────┬───────┘
                                  │    │
                         REST API │    │ REST API
                                  │    │
                    ┌─────────────▼┐  ┌▼──────────────────────┐
                    │ Next.js Web │  │ React Native Mobile   │
                    │             │  │ Expo SDK 57           │
                    │ Public      │  │ React Native 0.86     │
                    │ User        │  │ TypeScript            │
                    │ Provider    │  │ Expo Router           │
                    │ Admin       │  │ Development Build     │
                    └─────────────┘  └───────────────────────┘
```

Important rules:

- There is one backend.
- Web and mobile consume the same domain logic.
- Never duplicate booking/business rules in the mobile client.
- Never trust the mobile client for authorization.
- Role and permission enforcement stays on the backend.
- Client-side role handling is for navigation and UX only.
- Backend remains authoritative for status transitions.
- Backend remains authoritative for approval states.
- Backend remains authoritative for validation and permissions.

---

# 6. Why Expo Is the Selected Framework

## 6.1 Selected

Use:

**Expo + React Native + Expo Development Builds**

## 6.2 Not Selected as the Starting Point

Do not start with:

**Bare React Native / Community CLI**

unless a hard native requirement later makes it necessary.

## 6.3 Reasons

Expo is preferred for this application because the mobile feature set is primarily:

- REST API consumption
- authentication
- secure token storage
- image selection
- document/image uploads
- notifications
- deep links
- navigation
- forms
- caching
- common device capabilities

These are normal production mobile requirements and do not justify accepting additional bare-native maintenance from day one.

Expo improves:

- project setup
- native dependency compatibility
- build management
- signing workflows
- development builds
- notification setup
- deep linking
- native configuration
- upgrade workflow
- Android/iOS consistency
- CI/CD ergonomics

The project still retains native flexibility.

If later required, Expo can support:

- config plugins
- generated native Android/iOS projects
- Kotlin code
- Swift/Objective-C code
- custom native modules
- specialized hardware integrations
- proprietary SDKs
- Bluetooth
- telematics
- advanced background services

Therefore Expo is not a dead end.

---

# 7. Expo Go vs Development Builds

This distinction is mandatory.

## Expo Go

Expo Go may be used only for very early experimentation where it happens to work.

Do not design the production development workflow around Expo Go.

Expo Go has a fixed native runtime and therefore cannot represent every native dependency that the real application may require.

## Expo Development Build

The actual project should use a **Development Build**.

This means:

- the project has its own application binary
- required native modules are compiled into the application
- native configuration is under project control
- custom native modules remain possible
- development more closely matches production

Install and configure `expo-dev-client`.

The mobile agent should assume development builds are the normal workflow.

---

# 8. Core Version Baseline

The approved baseline for the current implementation is:

| Component    | Project Baseline    |
| ------------ | ------------------- |
| Expo         | SDK 57              |
| React Native | 0.86                |
| React        | 19.2.3              |
| Node.js      | 24 LTS preferred    |
| Language     | TypeScript          |
| Routing      | Expo Router         |
| Server state | TanStack Query      |
| Forms        | React Hook Form     |
| Validation   | Zod                 |
| Backend      | Existing NestJS     |
| Database     | Existing PostgreSQL |
| ORM          | Existing Prisma     |

Important:

- Treat these as the initial project baseline.
- Pin dependency versions through the project lockfile.
- Do not casually upgrade React Native independently from Expo.
- Let the selected Expo SDK define the compatible React Native version.
- For Expo-owned/native packages, prefer `npx expo install`.
- Do not use `"*"` dependency versions.
- Do not run blind dependency upgrades in production branches.

---

# 9. Long-Term Version Support Policy

React Native should not be treated like a multi-year static LTS runtime.

The correct strategy is controlled maintenance.

## Rules

1. Stay on stable Expo SDK releases.
2. Do not adopt React Native release candidates in production.
3. Do not adopt Expo beta/canary releases for production.
4. Upgrade one Expo SDK generation at a time when practical.
5. Review release notes before upgrading.
6. Test authentication, navigation, uploads, notifications and build pipelines after each upgrade.
7. Keep a working production branch while performing upgrades.
8. Upgrade native libraries only when compatibility is known.
9. Prefer Expo-compatible packages with active maintenance.
10. Avoid accumulating multiple years of SDK debt.

## Major Upgrade Checklist

Before accepting a new Expo SDK:

- read Expo SDK release notes
- read React Native breaking changes
- verify Node.js support
- verify Android target/compile SDK changes
- verify iOS minimum deployment version changes
- verify Expo Router compatibility
- verify notification behavior
- verify SecureStore behavior
- verify image/document picker behavior
- verify EAS Build
- build Android production candidate
- build iOS production candidate
- run authentication regression tests
- run booking regression tests
- run upload regression tests
- run navigation/deep-link regression tests

---

# 10. Repository Strategy

If the current project is already a monorepo, the mobile application may live in that monorepo.

If it is not a monorepo, do not restructure the entire system just to create the mobile app.

A reasonable high-level repository arrangement is:

```text
project-root/
├── web/
├── backend/
├── mobile/
├── shared/                 # optional, only if intentionally introduced
├── docs/
└── README.md
```

If the existing repository uses different directory names, follow the current convention.

Do not move completed web/backend code without a reason.

---

# 11. Recommended Mobile Folder Structure

Use feature-oriented organization while keeping Expo Router routes thin.

```text
mobile/
│
├── app/
│   ├── _layout.tsx
│   ├── +not-found.tsx
│   │
│   ├── (public)/
│   │   ├── _layout.tsx
│   │   ├── index.tsx
│   │   ├── search.tsx
│   │   ├── vehicle/
│   │   │   └── [id].tsx
│   │   └── provider/
│   │       └── [id].tsx
│   │
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── forgot-password.tsx
│   │   ├── reset-password.tsx
│   │   └── verify-email.tsx
│   │
│   ├── (user)/
│   │   ├── _layout.tsx
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx
│   │   │   ├── home.tsx
│   │   │   ├── saved.tsx
│   │   │   ├── inquiries.tsx
│   │   │   └── profile.tsx
│   │   └── inquiry/
│   │       └── [id].tsx
│   │
│   └── (provider)/
│       ├── _layout.tsx
│       ├── (tabs)/
│       │   ├── _layout.tsx
│       │   ├── dashboard.tsx
│       │   ├── vehicles.tsx
│       │   ├── inquiries.tsx
│       │   └── profile.tsx
│       ├── vehicle/
│       │   ├── new.tsx
│       │   └── [id]/
│       │       └── edit.tsx
│       └── inquiry/
│           └── [id].tsx
│
├── src/
│   ├── api/
│   │   ├── client.ts
│   │   ├── errors.ts
│   │   ├── auth.api.ts
│   │   ├── users.api.ts
│   │   ├── providers.api.ts
│   │   ├── vehicles.api.ts
│   │   ├── listings.api.ts
│   │   ├── booking-requests.api.ts
│   │   ├── media.api.ts
│   │   └── notifications.api.ts
│   │
│   ├── auth/
│   │   ├── auth-context.tsx
│   │   ├── auth.types.ts
│   │   ├── auth-storage.ts
│   │   ├── auth-session.ts
│   │   └── auth-guards.ts
│   │
│   ├── features/
│   │   ├── auth/
│   │   ├── listings/
│   │   ├── vehicles/
│   │   ├── providers/
│   │   ├── booking-requests/
│   │   ├── saved-vehicles/
│   │   ├── profile/
│   │   └── notifications/
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── common/
│   │   ├── forms/
│   │   ├── vehicles/
│   │   ├── providers/
│   │   └── inquiries/
│   │
│   ├── hooks/
│   ├── schemas/
│   ├── storage/
│   ├── theme/
│   ├── constants/
│   ├── types/
│   └── utils/
│
├── assets/
├── app.config.ts
├── eas.json
├── package.json
├── tsconfig.json
└── README.md
```

The exact tree can evolve, but preserve these principles:

- routes are thin
- feature logic lives outside route files
- API functions are centralized
- auth/storage logic is centralized
- reusable UI components are shared
- no huge `utils.ts`
- no API requests scattered across screens
- no business status logic hardcoded in multiple screens

---

# 12. Navigation Architecture

Use **Expo Router**.

Route groups should reflect authentication state and role.

Suggested groups:

```text
(public)
(auth)
(user)
(provider)
```

The navigation layer must support:

- public browsing before login
- authentication redirects
- role-aware post-login navigation
- customer routes
- provider routes
- deep links to public vehicles/providers
- deep links to authenticated inquiry details where appropriate

Do not enforce security solely through route hiding.

For example:

- hiding provider routes from a customer is UX
- rejecting a customer request to provider APIs is backend authorization

Both are required.

---

# 13. Authentication Strategy

The existing backend already exposes:

```text
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/refresh
POST /auth/forgot-password
POST /auth/reset-password
POST /auth/verify-email
```

The mobile application should consume these endpoints instead of creating mobile-specific authentication logic unless required.

## 13.1 Token Storage

Do not persist sensitive authentication tokens in:

- AsyncStorage as plain text
- source code
- `.env` committed to Git
- Redux persistence
- logs

Use secure device storage.

Preferred Expo mechanism:

- `expo-secure-store`

The exact backend token contract must be inspected before implementation.

Do not assume whether the backend currently returns:

- access token only
- access + refresh token
- refresh token in cookie
- refresh token in response body
- token expiration fields

The mobile agent must inspect the existing backend auth implementation and adapt the client accordingly.

## 13.2 Request Flow

Expected pattern:

```text
Login
  ↓
Receive valid auth session
  ↓
Store permitted secure credentials
  ↓
Attach access token to API calls
  ↓
Access token expires / receives authorized refresh condition
  ↓
Attempt refresh once
  ↓
Update session
  ↓
Retry original request
```

Avoid refresh loops.

If refresh fails:

- clear local auth state
- clear secure credentials
- invalidate protected query cache
- return user to authentication flow

## 13.3 Session Bootstrap

When the app starts:

1. initialize secure storage/session
2. determine whether a session exists
3. validate/refresh if required
4. fetch `/users/me` or equivalent authenticated profile
5. determine role
6. render correct route group

Show a controlled bootstrap/splash/loading state while this happens.

Do not briefly expose protected screens before session resolution.

---

# 14. API Layer

The application should have one configured API client.

Do not create separate Axios/fetch configurations in every feature.

Example responsibilities for `src/api/client.ts`:

- base URL
- timeout
- request headers
- authentication header
- standardized error translation
- refresh-token coordination
- request retry rules where appropriate
- development logging without leaking secrets

Suggested modules:

```text
auth.api.ts
users.api.ts
providers.api.ts
vehicles.api.ts
listings.api.ts
booking-requests.api.ts
media.api.ts
notifications.api.ts
```

Map these to the existing backend modules.

---

# 15. Existing API Contract to Reuse

## Auth

```text
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/refresh
POST /auth/forgot-password
POST /auth/reset-password
POST /auth/verify-email
```

## Users

```text
GET    /users/me
PATCH  /users/me
GET    /users/me/saved-vehicles
POST   /users/me/saved-vehicles
DELETE /users/me/saved-vehicles/:id
```

## Providers

```text
POST  /providers
GET   /providers/me
PATCH /providers/me
GET   /providers/:id
POST  /providers/:id/submit-for-review
```

## Vehicles

```text
POST   /vehicles
GET    /vehicles
GET    /vehicles/:id
PATCH  /vehicles/:id
DELETE /vehicles/:id
POST   /vehicles/:id/images
DELETE /vehicles/:id/images/:imageId
```

## Listings / Search

```text
GET /listings
GET /listings/featured
GET /listings/search
```

## Booking Requests

```text
POST  /booking-requests
GET   /booking-requests/me
GET   /booking-requests/provider
GET   /booking-requests/:id
PATCH /booking-requests/:id/status
```

## Admin

Admin endpoints exist in the backend but are not the primary mobile target.

Do not remove or modify them while implementing the mobile application.

---

# 16. Server State — TanStack Query

Use **TanStack Query** for server-owned data.

Examples:

- listings
- featured vehicles
- vehicle details
- provider details
- current user profile
- saved vehicles
- user inquiries
- provider inquiries
- provider vehicles
- provider profile
- verification status

Do not put all API data into global client state.

Use query keys consistently.

Example concept:

```text
['listings', filters]
['vehicle', vehicleId]
['provider', providerId]
['me']
['savedVehicles']
['myInquiries', filters]
['providerInquiries', filters]
['providerVehicles', filters]
```

Mutations should invalidate or update only relevant queries.

Example:

After saving a vehicle:

- update/invalidate saved vehicles
- update favorite state on relevant vehicle/listing cache

After provider inquiry status update:

- update inquiry detail
- invalidate provider inquiry list
- update dashboard counts when needed

---

# 17. Client State

Keep client state small.

Appropriate client state examples:

- local UI preferences
- temporary filter state
- draft form state
- modal/sheet state
- selected tab
- authentication bootstrap state

Do not duplicate server records in a separate global store unless there is a documented need.

Start without adding Redux/Zustand by default.

Add a state library only when a real cross-feature client-state problem appears.

---

# 18. Forms and Validation

Use:

- React Hook Form
- Zod
- `@hookform/resolvers` where appropriate

Mobile validation should improve UX, but the backend remains authoritative.

Important forms include:

- login
- registration
- forgot password
- reset password
- profile update
- provider onboarding/profile
- add vehicle
- edit vehicle
- booking inquiry
- provider notes
- availability/pricing notes where implemented

Validation rules should match backend DTOs.

Do not silently create different constraints between web, backend and mobile.

---

# 19. Shared API Types / Contract Strategy

Recommended long-term improvement:

Expose or maintain a reliable OpenAPI/Swagger contract from NestJS and generate TypeScript API types/client contracts.

Benefits:

- fewer mismatched field names
- safer backend changes
- mobile/web compile-time feedback
- shared enums
- safer status handling
- safer request/response evolution

If OpenAPI generation already exists, reuse it.

If it does not exist, do not block the first mobile bootstrap on building an elaborate code-generation system. Introduce it deliberately.

At minimum, centralize types.

Important enums include:

```text
UserStatus
ProviderStatus
VehicleStatus
BookingRequestStatus
DocumentStatus
```

Do not reproduce string literals such as `"pending"`, `"approved"` and `"rejected"` throughout UI files.

---

# 20. Search and Listing Experience

The public mobile listing experience should include:

- search field
- city/location input if supported
- filter sheet/drawer
- sort control
- vehicle cards
- loading skeletons
- empty states
- error states
- pagination or infinite scrolling

For mobile, prefer a bottom sheet/modal filter experience rather than desktop-style persistent sidebars.

The existing backend listing/search endpoints remain the data source.

Do not implement filtering only on the client if the backend already supports server-side filtering.

---

# 21. Vehicle Detail Experience

Vehicle detail should support:

- image gallery
- title
- pricing
- specs
- features
- provider summary
- provider link
- save/favorite action
- booking inquiry CTA
- related vehicles when API support exists

Important:

- image gallery must perform well
- large images should not block the main UI
- use stable image dimensions/placeholders
- handle missing images
- handle deleted/unpublished vehicles gracefully

---

# 22. Provider Profile Experience

Provider profile should include available public data such as:

- business/showroom name
- logo
- banner
- description
- contact summary
- location
- service area
- business details
- fleet preview
- verification/trust indicators where permitted
- inquiry/contact CTA

Do not expose verification documents or sensitive provider information publicly.

---

# 23. Booking Inquiry Flow

The booking flow is an **inquiry/request flow**, not full automated booking/payment unless the backend has changed.

Do not make UI language imply guaranteed booking confirmation if the backend still represents an inquiry.

The request can include fields currently represented by the backend, such as:

- vehicle
- requested from date
- requested to date
- pickup location
- message

Expected status values from the original system include:

```text
pending
contacted
accepted
rejected
cancelled
completed
```

The backend controls valid transitions.

The mobile client must not invent transition rules independently.

---

# 24. Provider Inquiry Management

Provider mobile screens should support:

- inquiry list
- status filtering
- inquiry detail
- user/request summary
- requested dates
- pickup information
- message
- status history if API exposes it
- accept/reject/contact actions
- notes where supported

Confirm exact authorization and status-transition rules from the backend before wiring buttons.

Do not display an action just because a status string exists.

---

# 25. Saved Vehicles

Customer flow should support:

- view saved vehicles
- save vehicle
- remove saved vehicle
- immediate optimistic UX only if rollback is correctly implemented
- synchronization with backend

Saved status must survive application restarts because the backend is authoritative.

---

# 26. Media and Uploads

The backend already includes image/document upload concepts.

Potential mobile requirements:

- select image from library
- take photo if product requires it
- upload provider logo/banner
- upload verification documents
- upload vehicle images

Recommended Expo modules may include:

- `expo-image-picker`
- `expo-document-picker`
- `expo-image`
- camera package only if actual camera capture is required

Do not request device permissions before the user initiates a feature that needs them.

Validate:

- file type
- file size
- image count
- upload failure
- retry state
- deleted/replaced upload state

Backend validation remains authoritative.

---

# 27. Notifications

The backend reference includes notification hooks and future status notifications.

When push notifications are introduced, use Expo-compatible notification tooling unless the project later requires a different provider architecture.

Potential notification events:

- booking inquiry created
- provider received inquiry
- inquiry status changed
- provider approved/rejected
- vehicle approved/rejected
- verification status changed

Do not make notifications a prerequisite for the first authentication/listing milestone.

Implement notification infrastructure after the core API flows are stable.

---

# 28. Deep Linking

Plan routing so these can eventually deep link cleanly:

```text
/vehicle/:id
/provider/:id
/inquiry/:id
```

Potential sources:

- email
- push notifications
- marketing links
- website links

Do not tightly couple screen behavior to one navigation entry path.

---

# 29. Environment Strategy

At minimum support:

- local/development
- staging
- production

Example conceptual variables:

```env
EXPO_PUBLIC_API_BASE_URL=
EXPO_PUBLIC_APP_ENV=
```

Only expose values safe to exist in the client bundle through public Expo environment variables.

Never place secrets in Expo public environment variables.

Examples of values that must not be shipped as client secrets:

- backend private keys
- database URLs
- JWT signing secrets
- service-account private keys
- admin credentials
- private S3 credentials

Mobile applications must be assumed inspectable by users.

---

# 30. API Base URL Rules

Do not hardcode:

```text
http://localhost:3000
```

throughout application files.

Centralize base URL configuration.

Remember:

- Android emulator localhost behavior differs from host machine localhost
- physical devices cannot access a development server through `localhost`
- staging and production require HTTPS

Production API traffic must use HTTPS.

---

# 31. UI / UX Principles

Carry forward the existing product principles:

- mobile-first
- keep forms short
- reduce provider onboarding friction
- make vehicle cards visually rich
- use clear status badges
- emphasize trust signals
- avoid clutter
- use clear empty states
- include helper text
- show loading states
- show recoverable error states

Mobile-specific principles:

- large touch targets
- thumb-friendly primary actions
- safe-area support
- keyboard-aware forms
- accessible labels
- readable text sizing
- avoid huge desktop-style tables
- use cards/lists for compact mobile information
- use bottom sheets/modals for filters and contextual actions

---

# 32. Reusable Mobile Components

Suggested reusable primitives:

```text
AppButton
AppText
AppInput
AppSelect
AppTextarea
AppCard
AppBadge
AppAvatar
AppDivider
AppSkeleton
AppErrorState
AppEmptyState
AppLoadingState
AppScreen
AppHeader
ConfirmDialog
BottomSheet
DateField
ImagePickerField
DocumentPickerField
StatusBadge
```

Feature components:

```text
VehicleCard
VehicleList
VehicleGallery
VehicleSpecs
ProviderCard
ProviderHeader
ProviderFleetPreview
InquiryCard
InquiryStatusBadge
InquiryTimeline
SearchBar
FilterSheet
SortSheet
ProfileForm
ProviderProfileForm
VehicleForm
```

Do not build every component before it is needed.

Extract reusable components after patterns are clear.

---

# 33. Styling Strategy

Choose one consistent styling approach and use it across the mobile app.

Do not mix several competing styling systems without a reason.

The existing web project uses Tailwind/shadcn concepts, but mobile is not required to reuse web components.

Possible approaches include:

- React Native StyleSheet
- a well-maintained utility styling solution compatible with the selected Expo/RN version
- a project-specific token/theme system

The important requirement is consistency.

Create design tokens for:

- spacing
- typography
- radii
- shadows
- colors
- status semantics

Do not copy web CSS directly into React Native.

---

# 34. Error Handling

Create a normalized API error model.

UI should distinguish, where possible:

- validation error
- unauthorized
- forbidden
- not found
- conflict
- rate limited
- network unavailable
- server error
- unknown error

Do not show raw backend stack traces or internal messages to end users.

Provide:

- retry actions
- field-level form errors
- friendly empty states
- clear session-expired handling

---

# 35. Offline and Network Behavior

The initial application does not need to become an offline-first database application.

However it should behave cleanly under poor connectivity.

At minimum:

- cached read data where appropriate
- retry controls
- clear network errors
- prevent duplicate inquiry submission
- prevent duplicate provider status mutations
- disable repeated submit taps while request is active

Do not queue sensitive mutations offline unless a deliberate synchronization design is introduced.

---

# 36. Security Requirements

Carry forward the backend security principles and add mobile-specific protection.

Required:

- HTTPS in production
- secure token storage
- no secrets committed to source
- no secrets printed in logs
- server-side authorization
- server-side validation
- role checks
- file validation
- rate limiting on backend
- protected document URLs
- safe error messages
- token/session cleanup on logout
- clear cached protected data on account switch/logout

Avoid:

- storing passwords
- logging full tokens
- embedding admin credentials
- assuming hidden UI equals authorization
- trusting role values provided by the client
- persisting sensitive documents locally without a requirement

---

# 37. Observability

Existing system guidance includes Sentry.

The mobile application should eventually support:

- crash reporting
- JavaScript exception reporting
- release/environment tagging
- API error breadcrumbs without sensitive data
- important navigation breadcrumbs
- performance visibility where useful

Do not log:

- passwords
- refresh tokens
- full access tokens
- private verification documents
- highly sensitive user data

---

# 38. Analytics

Existing product metrics include:

- visitors
- listing views
- inquiry conversion rate
- provider signups
- vehicle approval rate
- inquiry response time
- repeat visits
- active providers
- approved vehicles

For mobile, useful events may include:

```text
app_opened
search_submitted
filter_applied
vehicle_viewed
provider_viewed
vehicle_saved
vehicle_unsaved
inquiry_started
inquiry_submitted
login_succeeded
registration_succeeded
provider_vehicle_created
provider_inquiry_opened
provider_inquiry_status_changed
```

Analytics must not block core feature development.

Do not send sensitive payloads into analytics.

---

# 39. Testing Strategy

## 39.1 Unit Tests

Prioritize testable logic such as:

- schema validation
- formatters
- query parameter builders
- auth-session helpers
- status display helpers
- API error normalization

## 39.2 Component Tests

Prioritize important reusable/critical components:

- login form
- inquiry form
- vehicle card
- status badge
- provider actions

## 39.3 Integration / End-to-End

Highest-value flows:

### Customer

1. launch app
2. browse listing
3. open vehicle
4. register/login
5. save vehicle
6. submit inquiry
7. view inquiry status

### Provider

1. login
2. view dashboard
3. view vehicle list
4. add/edit vehicle
5. upload image
6. view inquiry
7. update inquiry status

### Authentication

1. login
2. session restore
3. access token expiry
4. refresh
5. logout
6. invalid refresh -> clean logout

---

# 40. Android / iOS Build Strategy

Use Expo/EAS-compatible builds.

The project should support:

- development builds
- preview/staging builds
- production builds

Conceptual build profiles:

```text
development
preview
production
```

Do not publish directly from random local state.

Production builds should come from:

- a clean Git commit
- locked dependencies
- approved environment configuration
- tested API environment
- known app version/build number

---

# 41. Release Strategy

Before first store submission:

## Product

- auth works
- customer browsing works
- search/filter works
- vehicle detail works
- saved vehicles work
- inquiry flow works
- profile works
- provider functions intended for release work

## Security

- production HTTPS
- correct API URL
- no development secrets
- no debug logs with tokens
- secure session handling

## Quality

- loading states
- error states
- empty states
- form validation
- image handling
- small-device testing
- larger-device testing
- Android testing
- iOS testing

## Operations

- crash reporting
- production app identifiers
- signing configured
- privacy policy available
- store metadata prepared
- icons/splash assets final
- notification permissions justified if used

---

# 42. Dependency Policy

## Expo / Native Packages

Prefer:

```bash
npx expo install <package>
```

for Expo/native ecosystem dependencies because Expo resolves versions compatible with the current SDK.

## Pure JavaScript Libraries

Use the package manager normally, but pin through the lockfile.

## Avoid

- abandoned native modules
- packages with unclear New Architecture support
- multiple libraries solving the same problem
- manually forcing incompatible peer dependencies
- unnecessary custom native code

Before adding a dependency, ask:

1. Is it really needed?
2. Can the platform/Expo already do it?
3. Is it actively maintained?
4. Is it compatible with Expo SDK 57 / RN 0.86?
5. Does it work on both Android and iOS?
6. Does it introduce native build requirements?
7. How will upgrades be handled?

---

# 43. Initial Dependency Direction

Do not install every possible dependency on day one.

Start small.

Core likely dependencies:

```text
expo
expo-router
expo-dev-client
react
react-native
@tanstack/react-query
react-hook-form
zod
@hookform/resolvers
expo-secure-store
```

Likely feature dependencies later:

```text
expo-image
expo-image-picker
expo-document-picker
expo-notifications
expo-device
expo-constants
```

Use an HTTP implementation consistently.

Either:

- native `fetch` with a well-designed wrapper

or:

- Axios with a centralized client

Do not mix request stacks randomly.

---

# 44. Project Bootstrap

The approved initial creation direction is:

```bash
npx create-expo-app@latest kerayego-mobile --template default@sdk-57
```

Then:

```bash
cd kerayego-mobile
```

Add the development client:

```bash
npx expo install expo-dev-client
```

Add secure storage:

```bash
npx expo install expo-secure-store
```

Add server-state/forms/validation packages using compatible current releases:

```bash
npm install @tanstack/react-query react-hook-form zod @hookform/resolvers
```

Do not blindly copy commands if the repository is already initialized.

If a `mobile/` application already exists, inspect it first.

---

# 45. What the Agent Must Do First

This section defines the **immediate work order**.

## Step 0 — Inspect Existing System

Before writing significant mobile code, inspect:

- backend base URL conventions
- auth controller/service
- login response
- refresh-token implementation
- `/users/me` response
- user role representation
- provider role representation
- listing response models
- vehicle detail response
- provider public response
- saved vehicle API payloads
- booking request payloads
- booking status update payloads
- media upload contract
- CORS/network setup
- Swagger/OpenAPI availability

Do not assume the payload shapes from route names alone.

## Step 1 — Bootstrap Mobile Project

Create/configure the Expo SDK 57 project.

Verify:

- TypeScript works
- Expo Router works
- development build configuration exists
- Android build starts
- iOS build configuration is valid
- linting/formatting works
- `.env` approach is documented
- package lock is committed

## Step 2 — Establish Foundation

Implement:

```text
src/api/client.ts
src/api/errors.ts
src/auth/auth-storage.ts
src/auth/auth-context.tsx
src/auth/auth-session.ts
src/types/
src/schemas/
```

Set up:

- QueryClient
- root providers
- theme/safe-area
- app bootstrap state
- API environment configuration

## Step 3 — Authentication

Implement:

- login
- secure session persistence
- app relaunch session restore
- refresh handling
- logout
- register
- forgot/reset password as supported
- role-aware redirect

Do not proceed deeply into provider/customer dashboards before auth/session handling is reliable.

## Step 4 — Public Marketplace

Implement:

- home/explore
- featured vehicles
- listings
- search
- filters
- sort
- vehicle detail
- provider profile

## Step 5 — Customer Account

Implement:

- profile
- saved vehicles
- inquiry submission
- inquiry list
- inquiry detail
- status display

## Step 6 — Provider Experience

Implement:

- provider dashboard summary
- provider profile
- provider vehicles
- add/edit vehicle
- media upload
- provider inquiries
- inquiry actions
- verification state

## Step 7 — Notifications / Deep Links

Only after the core domain flows are stable:

- push registration
- notification handling
- notification-to-route behavior
- deep linking

## Step 8 — Hardening

Implement/finalize:

- error states
- retries
- empty states
- loading skeletons
- accessibility
- keyboard handling
- slow network behavior
- security review
- crash reporting
- analytics
- production builds

---

# 46. First Milestone Definition

The first milestone is **not** "all screens designed."

The first milestone is a vertical production-capable foundation.

Definition of Done:

- Expo SDK 57 app created
- Development Build works
- environment configuration works
- API client works
- QueryClient configured
- secure auth storage implemented
- login works against the existing backend
- session restores after app restart
- token refresh works according to backend contract
- logout clears session correctly
- `/users/me` works
- role is known
- route protection works
- customer/provider route groups exist
- at least one public listing endpoint renders real backend data
- errors are normalized
- no tokens are logged
- project README explains setup

This milestone should be completed before building large numbers of UI screens.

---

# 47. Suggested First Screens

Recommended order:

```text
1. App bootstrap / splash state
2. Login
3. Public home / explore
4. Vehicle listing
5. Vehicle detail
6. Register
7. Customer profile shell
8. Saved vehicles
9. Booking inquiry form
10. My inquiries
11. Inquiry detail
12. Provider dashboard shell
13. Provider vehicle list
14. Provider inquiry list
15. Provider inquiry detail
16. Provider vehicle form
17. Provider profile
```

This order creates usable end-to-end flows early.

---

# 48. Status Mapping

Create centralized display mapping.

Example concept:

```ts
const bookingStatusMeta = {
  pending: { label: 'Pending' },
  contacted: { label: 'Contacted' },
  accepted: { label: 'Accepted' },
  rejected: { label: 'Rejected' },
  cancelled: { label: 'Cancelled' },
  completed: { label: 'Completed' },
};
```

The actual UI styling may add status colors/icons through the theme.

Do not repeat status display logic across screen files.

Apply the same approach to:

- user status
- provider status
- vehicle status
- document status

---

# 49. Performance Guidelines

Prioritize performance where it matters:

- large listing lists
- image galleries
- provider fleets
- inquiry lists

Use:

- stable list keys
- appropriate list virtualization
- image caching
- pagination/infinite query where supported
- memoization only where measured/useful
- query caching

Avoid:

- fetching full lists when pagination exists
- re-fetching every screen on every render
- huge images without sizing
- nesting uncontrolled long scroll views
- premature global optimization

---

# 50. Accessibility

Minimum expectations:

- accessible labels
- sufficient touch target sizes
- readable contrast
- keyboard-friendly form flow
- meaningful button labels
- screen-reader friendly icons
- errors associated with relevant fields
- status meaning not communicated only by color

---

# 51. Platform Differences

Do not assume Android and iOS behave identically.

Verify both for:

- keyboard behavior
- date input
- image picker
- document picker
- secure storage
- permissions
- notifications
- deep links
- safe areas
- back navigation
- form autofill
- external links/contact actions

---

# 52. Contact Actions

Provider/customer contact flows may eventually include:

- phone
- email
- WhatsApp
- in-app contact

Do not hardcode unsupported communication channels.

Use backend/provider data and product requirements.

Validate external URL schemes before opening them.

---

# 53. Future-Ready Architecture

The existing platform intentionally leaves room for:

- payment
- booking automation
- commissions
- SaaS
- multi-tenancy
- white-label portals
- analytics
- driver/fleet management
- telematics

The mobile client should remain modular so these can be added later.

Do not implement speculative architecture for all of them now.

Good preparation means:

- clean domain boundaries
- centralized API layer
- centralized status enums
- role-aware navigation
- typed request/response models
- modular features
- upgradeable framework
- secure auth

It does **not** mean prematurely implementing payments, fleet tracking or multi-tenant client state.

---

# 54. Things the Agent Must NOT Do

Do not:

- create a separate mobile backend
- copy backend business logic into React Native
- replace NestJS
- replace PostgreSQL
- replace Prisma
- rewrite completed web/admin functionality without a request
- start with bare React Native CLI
- depend on Expo Go as the permanent workflow
- adopt React Native RC/beta releases
- manually upgrade React Native independently of Expo
- put JWT secrets in the app
- store sensitive tokens in plain AsyncStorage
- hardcode localhost throughout the app
- use admin APIs from customer UI
- duplicate every web page 1:1
- build large admin tables for mobile first
- add Redux by default
- install dozens of dependencies before features need them
- invent API payloads without inspecting the backend
- invent status transitions
- bypass backend authorization
- swallow API errors silently
- expose internal document URLs carelessly
- log access/refresh tokens
- use wildcard package versions
- perform blind dependency upgrades

---

# 55. Things the Agent SHOULD Do

Do:

- reuse the existing backend
- inspect existing backend contracts first
- use Expo SDK 57
- use React Native 0.86 through Expo
- use TypeScript
- use Expo Router
- use Development Builds
- use TanStack Query for server state
- use React Hook Form + Zod
- use secure storage
- centralize API configuration
- centralize auth handling
- centralize enums/status display
- keep routes thin
- keep features modular
- build vertical slices
- handle loading/error/empty states
- verify Android and iOS behavior
- keep dependencies pinned
- document environment setup
- maintain a clear upgrade strategy
- preserve backend role enforcement
- preserve existing audit/approval concepts
- build customer/provider mobile value first

---

# 56. Recommended Development Workflow

For each feature:

```text
1. Inspect backend endpoint
2. Confirm request/response contract
3. Add/confirm TypeScript types
4. Add API function
5. Add TanStack Query hook
6. Add validation schema if mutation/form
7. Build reusable feature component
8. Build screen/route
9. Handle loading
10. Handle empty state
11. Handle API errors
12. Test success and failure
13. Test Android
14. Test iOS when platform behavior is relevant
```

This is preferred over designing all screens first and wiring APIs later.

---

# 57. Example Feature Slice

Example: vehicle details.

```text
Backend:
GET /vehicles/:id

Mobile:
src/api/vehicles.api.ts
src/features/vehicles/queries.ts
src/features/vehicles/components/VehicleGallery.tsx
src/features/vehicles/components/VehicleSpecs.tsx
src/features/vehicles/components/VehicleActions.tsx
app/(public)/vehicle/[id].tsx
```

The route should orchestrate the feature.

It should not contain the entire implementation.

---

# 58. Example Booking Inquiry Slice

```text
Backend:
POST /booking-requests

Mobile:
src/api/booking-requests.api.ts
src/features/booking-requests/schemas.ts
src/features/booking-requests/mutations.ts
src/features/booking-requests/components/InquiryForm.tsx
```

Flow:

```text
Vehicle Detail
  ↓
Book / Send Inquiry
  ↓
Authenticated?
  ├── No -> Login/Register -> return to inquiry
  └── Yes
        ↓
     Inquiry Form
        ↓
     Validate
        ↓
     POST /booking-requests
        ↓
     Success state
        ↓
     My Inquiries / Inquiry Detail
```

Do not lose the user's intended vehicle after an auth redirect.

---

# 59. Example Provider Inquiry Slice

```text
Backend:
GET   /booking-requests/provider
GET   /booking-requests/:id
PATCH /booking-requests/:id/status

Mobile:
src/features/booking-requests/provider/
```

Flow:

```text
Provider Dashboard
  ↓
Incoming Inquiries
  ↓
Inquiry Detail
  ↓
Allowed Actions
  ↓
PATCH status
  ↓
Update detail cache
  ↓
Invalidate provider list/dashboard stats
```

---

# 60. Documentation Requirements Inside Mobile Repo

The mobile `README.md` should eventually include:

- required Node version
- package manager
- install command
- environment setup
- local API configuration
- Android development build instructions
- iOS development build instructions
- EAS setup
- project architecture
- route groups
- auth behavior
- build profiles
- common troubleshooting
- upgrade policy

Do not make future agents rediscover basic setup.

---

# 61. Decision Log

## Decision 001 — Mobile Framework

**Decision:** Expo + React Native.

**Reason:** Production-grade framework support, lower native maintenance, good compatibility with required features, native extensibility remains available.

**Rejected starting option:** Bare React Native CLI.

---

## Decision 002 — Development Runtime

**Decision:** Expo Development Builds.

**Reason:** Custom native modules/configuration are possible and runtime matches production more closely.

**Rejected long-term workflow:** Expo Go.

---

## Decision 003 — Core Version

**Decision:** Expo SDK 57 + React Native 0.86 + React 19.2.3.

**Reason:** Stable production baseline selected for the project.

---

## Decision 004 — Routing

**Decision:** Expo Router.

**Reason:** File-based routing, deep-link compatibility, route groups, clean role/auth flow.

---

## Decision 005 — Server State

**Decision:** TanStack Query.

**Reason:** Backend is authoritative; query caching/mutations map naturally to REST APIs.

---

## Decision 006 — Forms

**Decision:** React Hook Form + Zod.

**Reason:** Consistent with existing web/backend validation direction and scalable for complex provider/vehicle forms.

---

## Decision 007 — Backend

**Decision:** Reuse the existing NestJS backend.

**Reason:** Backend already contains the required modular domains and business rules.

**Rejected:** New mobile-specific backend.

---

## Decision 008 — Admin

**Decision:** Keep full Admin/Super Admin primarily on web for initial mobile phases.

**Reason:** Operational/admin workflows are more suitable for desktop and are not necessary to deliver customer/provider mobile value.

---

# 62. Production Definition

"Production-ready" for this project does **not** mean only that the app builds.

It means:

- stable framework versions
- development build workflow
- secure authentication
- correct backend role enforcement
- reliable API errors
- correct environment handling
- no secrets in bundle
- store-compatible Android/iOS builds
- crash visibility
- regression-tested core flows
- upgradeable dependencies
- documented architecture
- maintainable feature boundaries

---

# 63. Immediate Agent Checklist

Use this checklist at the beginning of implementation.

- [ ] Read the original Phase 1 reference.
- [ ] Read this mobile implementation reference.
- [ ] Inspect the current backend repository.
- [ ] Inspect authentication response and refresh-token contract.
- [ ] Inspect user/provider role representation.
- [ ] Inspect listing/vehicle/provider API response shapes.
- [ ] Inspect booking request payloads and allowed status transitions.
- [ ] Inspect media upload endpoints.
- [ ] Check whether Swagger/OpenAPI already exists.
- [ ] Confirm whether a `mobile/` project already exists.
- [ ] If not, bootstrap Expo SDK 57.
- [ ] Configure Expo Development Build.
- [ ] Configure TypeScript/linting/formatting.
- [ ] Configure environment variables.
- [ ] Configure centralized API client.
- [ ] Configure TanStack Query.
- [ ] Configure secure auth storage.
- [ ] Implement app/session bootstrap.
- [ ] Implement login.
- [ ] Implement token refresh according to actual backend behavior.
- [ ] Implement logout.
- [ ] Implement `/users/me`.
- [ ] Implement role-aware routing.
- [ ] Render real public listing data.
- [ ] Establish loading/error/empty patterns.
- [ ] Document setup before expanding feature count.

---

# 64. Current "Do This Next" Instruction

Unless the project owner gives a different instruction, the next coding task should be:

1. inspect the existing backend auth/API contract
2. create or inspect the Expo SDK 57 mobile app
3. configure Development Builds
4. establish environment configuration
5. establish the API client
6. establish TanStack Query
7. implement secure authentication/session bootstrap
8. verify login + refresh + logout against the real backend
9. implement role-aware Expo Router groups
10. connect the first real listing endpoint

Do **not** begin by building dozens of static screens.

The first goal is a working vertical foundation connected to the existing production architecture.

---

# 65. Final Architecture Summary

```text
                        RENTAL SERVICES PLATFORM
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
             NEXT.JS WEB                     MOBILE APP
                 │                                 │
        Public/User/Provider/Admin        Customer + Provider
                 │                                 │
                 └──────────────┬──────────────────┘
                                │
                          NESTJS REST API
                                │
          ┌─────────────────────┼─────────────────────────┐
          │        │            │          │              │
         Auth    Users       Providers   Vehicles     Bookings
          │        │            │          │              │
          └─────────────────────┼─────────────────────────┘
                                │
                       PostgreSQL / Prisma
```

Mobile stack:

```text
Expo SDK 57
    ↓
React Native 0.86
    ↓
React 19.2.3
    ↓
TypeScript
    ↓
Expo Router
    ↓
Expo Development Builds
    ↓
TanStack Query
React Hook Form
Zod
SecureStore
    ↓
Existing NestJS REST API
```

Primary principle:

> **Keep the mobile client simple, modular, secure, API-driven, and easy to upgrade. Reuse the existing backend and business rules. Build customer/provider value first, and preserve native flexibility without accepting bare-native complexity before it is needed.**

---

# 66. Source of Product Truth

This document is a mobile implementation extension of:

`rental_car_phase1_reference(1).md`

That original file defines the core product domains, backend modules, role model, APIs, statuses, security expectations and future-ready architecture.

When implementing a feature:

1. use the original Phase 1 reference for product scope
2. use this document for mobile implementation decisions
3. inspect actual backend code/API behavior for the final technical contract
4. if the real backend has evolved beyond the reference, document the difference rather than guessing

---

**End of mobile implementation reference.**
