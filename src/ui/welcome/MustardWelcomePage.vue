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

      <section class="get-started">
        <p>
          Ready to try it out? Head over to our
          <a href="https://fettstorch.github.io/mustard/" target="_blank">Hello Mustard</a>
          page and leave your very first note!
        </p>
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

.get-started {
  text-align: center;
}

.get-started a {
  color: var(--mustard-brown);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.get-started a:hover {
  color: var(--mustard-border);
}
</style>
