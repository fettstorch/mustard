<script setup lang="ts">
const logoUrl = chrome.runtime.getURL('mustard_bottle_smile_512.png')
</script>

<template>
  <div class="welcome-page">
    <div class="hero">
      <img :src="logoUrl" alt="Mustard" class="logo" />
      <h1>Welcome to Mustard!</h1>
      <p class="tagline">Add your opinion to any webpage.</p>
    </div>

    <div class="content">
      <a href="https://fettstorch.github.io/mustard/" target="_blank" class="cta-banner">
        <span class="cta-text">
          Ready to try it out?<br />
          Head over to <strong>Hello Mustard</strong> and leave your very first note!
        </span>
        <span class="cta-arrow">&#10132;</span>
      </a>

      <section>
        <h2>What is Mustard?</h2>
        <p>
          Mustard lets you annotate any webpage with notes — like adding your "mustard" (from the
          German saying <em>"seinen Senf dazu geben"</em>). Save notes locally or publish them to
          your Bluesky followers.
        </p>
      </section>

      <section>
        <h2>Ideas for your Mustard</h2>
        <ul>
          <li>Share your thoughts on something you just read</li>
          <li>Provide additional context to a blog post</li>
          <li>Fact-check a news article</li>
          <li>Just slap a funny gif on something</li>
        </ul>
      </section>

      <section>
        <h2>How to use</h2>
        <ol>
          <li>
            <strong>Right-click</strong> on any element on a webpage and select
            <strong>"Add Mustard"</strong>
          </li>
          <li>Write your note (up to 300 characters)</li>
          <li>
            Click the <strong>floppy disk</strong> to save locally (no account needed) or the
            <strong>blue arrow</strong> to publish (requires Bluesky login)
          </li>
        </ol>
        <h3>Tips</h3>
        <ul>
          <li><strong>Drag notes around</strong> if they're covering something you want to see</li>
          <li>
            <strong>Toggle notes off</strong> via the extension popup — click the Mustard bottle
            icon in your toolbar
          </li>
          <li>
            <strong>Markdown supported</strong> — use <code>**bold**</code>, <code>*italic*</code>,
            <code>[links](url)</code>, and more
          </li>
          <li><strong>Add images &amp; gifs</strong> by pasting an image link into your note</li>
          <li><strong>Delete</strong> your own notes by clicking the bin icon</li>
        </ul>
      </section>

      <section class="warning">
        <h2>Do not publish sensitive information</h2>
        <p>
          Never include passwords, API keys, personal addresses, or other private data in published
          notes. Published notes are stored on our server and <strong>visible to anyone</strong> who
          follows you. Treat them like public posts.
        </p>
      </section>

      <section>
        <h2>Heads up</h2>
        <ul>
          <li>
            <strong>Content script on all pages:</strong> Mustard injects a content script on every
            page you visit to display notes. It does <em>not</em> read or collect any page data — it
            only checks if there are notes for the current URL.
          </li>
          <li>
            <strong>Local notes are truly local:</strong> Notes saved locally never leave your
            browser. They're stored in Chrome's extension storage.
          </li>
          <li>
            <strong>Early stage:</strong> Mustard is in early development. Expect rough edges, and
            please report any bugs!
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.welcome-page {
  max-width: 640px;
  margin: 0 auto;
  padding: 48px 24px;
  font-family: var(--mustard-font);
  color: var(--mustard-text);
}

.hero {
  text-align: center;
  margin-bottom: 48px;
}

.logo {
  width: 96px;
  height: 96px;
  margin-bottom: 16px;
}

h1 {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px;
}

.tagline {
  font-size: 16px;
  color: var(--mustard-brown-border);
  margin: 0;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

section {
  background: var(--mustard-gradient);
  border: 2px solid var(--mustard-border);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--mustard-plastic-shadow);
}

h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 12px;
}

p,
li {
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

ol,
ul {
  padding-left: 20px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 16px 0 8px;
}

em {
  font-style: italic;
}

code {
  background: var(--mustard-glass);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 13px;
}

.warning {
  background: #fff0f0;
  border: 3px solid #c0392b;
  box-shadow: none;
}

.warning h2 {
  color: #c0392b;
}

.cta-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 28px;
  background: var(--mustard-gradient);
  border: 3px dashed var(--mustard-brown-border);
  border-radius: 16px;
  box-shadow: var(--mustard-plastic-shadow);
  transform: rotate(-1.5deg);
  text-decoration: none;
  color: var(--mustard-brown);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.cta-banner:hover {
  transform: rotate(0deg) scale(1.02);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.cta-text {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
}

.cta-text strong {
  font-weight: 700;
}

.cta-arrow {
  font-size: 28px;
  flex-shrink: 0;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .welcome-page {
    background: #1a1a1a;
    color: #e5e5e5;
  }

  h1,
  h2,
  h3 {
    color: var(--mustard-yellow-light);
  }

  .tagline {
    color: var(--mustard-yellow);
  }

  section {
    background: linear-gradient(180deg, #2a2200 0%, #1f1a00 100%);
    border-color: var(--mustard-yellow-mid);
    box-shadow:
      inset 0 3px 0 rgba(255, 255, 255, 0.05),
      inset 0 15px 25px rgba(255, 255, 255, 0.03),
      0 4px 12px rgba(0, 0, 0, 0.5);
  }

  section p,
  section li {
    color: #d4d4d4;
  }

  code {
    background: rgba(255, 255, 255, 0.1);
    color: var(--mustard-yellow-light);
  }

  .warning {
    background: #2a0a0a;
    border-color: #e74c3c;
  }

  .warning h2 {
    color: #e74c3c;
  }

  .cta-banner {
    background: linear-gradient(180deg, #2a2200 0%, #1f1a00 100%);
    border-color: var(--mustard-yellow-mid);
    color: var(--mustard-yellow-light);
    box-shadow:
      inset 0 3px 0 rgba(255, 255, 255, 0.05),
      0 4px 12px rgba(0, 0, 0, 0.5);
  }
}
</style>
