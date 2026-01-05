# Mustard

A Chrome extension that lets users annotate web pages with "mustard" (notes) and follow others to see their annotations on the same pages.

## Project Vision

### The Concept

The name "mustard" comes from the German saying _"seinen Senf dazu geben"_ (to add one's opinion to something). This extension enables users to add their "mustard" (opinions/notes) to any webpage.

### Core Features

#### Note Creation & Management

- Users can annotate any part of any webpage with notes
- Notes can contain:
  - Text (up to 300 characters)
  - Images
  - Videos (future)
- **Creation workflow**: Right-click on any element → "Add Mustard" → Creation popup opens
- **Note editor**: GitHub-style comment interface (text + image support)
- Users can edit and delete their own notes
- Notes are public by default

#### Social Graph & Following

- Users can follow other users to see their mustard
- When visiting a page where a followed user has added mustard, those notes appear at the exact same locations
- Multiple follows' notes can appear on the same page simultaneously
- Users can hide individual notes or hide all notes from a specific user
- **Authentication**: Atproto and/or Google login for profiles and social graph
- Users can search for people to follow (e.g., via Atproto DIDs)

#### User Interface

- **Individual note menu**: Each note has a menu with options:
  - Hide note
  - Hide all notes from this user
  - Unfollow user
  - Edit (own notes only)
  - Delete (own notes only)
  - Report (for moderation)
- **Extension popup**: More elaborate menu showing:
  - All people who have mustard on the current webpage
  - Search for people to follow
  - Show/hide mustard toggle for the current page
- Easy show/hide toggle for mustard on any page

#### Page Identification & Note Positioning

- **Page matching**: URLs normalized without query parameters
- **Element anchoring**:
  - Primary: Element ID (if present)
  - Fallback: Text content hash (if no ID)
  - Relies on user common sense for SPAs and dynamic content
- Notes persist at the same locations for all users viewing the same page
- **Dynamic content detection**:
  - Extension monitors for dynamically loaded content via:
    - MutationObserver watching DOM changes
    - Intercepted fetch/XMLHttpRequest requests
  - When new elements are detected, mustard matching is re-executed
  - Allows mustard to appear on elements loaded after initial page load (SPAs, infinite scroll, etc.)
  - Debounced to avoid excessive re-matching

#### Content Moderation

- Report button on each note
- Admin center for reviewing reports
- Warning in creation popup about not storing sensitive information (passwords, etc.)

### Technical Architecture

#### Frontend (Chrome Extension)

- **Content Script**: Injects mustard notes into web pages
- **Background Service Worker**: Manages index fetching, follow relationships
- **Popup**: User interface for managing follows and viewing page-specific mustard
- **Options Page**: Settings and preferences

#### Backend Architecture

- **Database**: Stores all mustard notes and user data
- **Index System**:
  - Maps users → list of URLs where they have mustard
  - Loaded on browser start (if possible)
  - Backend provides freshly calculated index on request
  - Reduces database load by only fetching notes for pages where followed users have annotations
- **API**: RESTful API for all operations
- **Authentication**: Atproto and/or Google OAuth

#### Data Flow

1. User opens browser → Extension fetches follow index
2. User navigates to page → Extension checks index for followed users with mustard on this URL
3. If matches found → Extension fetches specific notes for this page
4. Notes are injected into the page at their anchored positions

### Technical Recommendations

#### Database Choice

**Recommendation: PostgreSQL** (but MySQL is fine if you're more comfortable)

**Why PostgreSQL:**

- Superior JSON support for storing note metadata and element selectors
- Better full-text search capabilities (useful for searching notes)
- More robust handling of complex queries
- Better performance for read-heavy workloads

**MySQL is acceptable** if you're more familiar with it, especially for MVP. Both can handle the use case.

#### API Architecture

**Recommendation: Start with REST, consider GraphQL later**

**REST is fine for MVP because:**

- Simpler to implement and understand
- Easier to debug
- Standard HTTP caching works well
- You already know it

**GraphQL could be beneficial later for:**

- Reducing over-fetching (only get fields you need)
- More flexible queries
- Better for complex social graph queries
- But adds complexity and learning curve

**Recommendation**: Start with REST, migrate to GraphQL if you find yourself making many round trips or over-fetching data.

#### Hosting

- Considering Koyeb (not yet decided)
- Not self-hosted

### Implementation Notes

- **MVP approach**: Discover iteratively what the smallest best thing to build next is
- **No WebSocket connections** for now (polling/on-demand fetching)
- **Caching**: Consider Redis for index caching later if needed, but start simple
- **Performance**: Index system designed to minimize database queries on every page load

## Technical Stack

- **Vue 3** - Frontend framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **@crxjs/vite-plugin** - Chrome extension build plugin

## Development

### Setup

```sh
npm install
```

### Development Commands

```sh
npm run dev
```

### Build

```sh
npm run build
```

### Type Check

```sh
npm run type-check
```

### Lint

```sh
npm run lint
```

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
