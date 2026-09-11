<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useData } from 'vitepress'
import { ShikiMagicMove } from '@shikijs/magic-move/vue'
import '@shikijs/magic-move/dist/style.css'

export interface SnippetPair {
  id: string
  title: string
  express: string
  volten: string
}

const props = withDefaults(
  defineProps<{
    initialMode?: 'express' | 'volten'
    initialSnippet?: string
  }>(),
  {
    initialMode: 'express',
    initialSnippet: 'full'
  }
)

const { isDark } = useData()

const snippets: SnippetPair[] = [
  {
    id: 'full',
    title: 'Full Application',
    express: `const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, 'public')));

// Auth middleware
const requireAuth = (req, res, next) => {
  const token = req.cookies.authToken;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.userId = 'user_123';
  next();
};

// Routes
app.get('/api/profile', requireAuth, (req, res) => {
  res.json({ userId: req.userId, name: 'Alice' });
});

app.post('/api/items', requireAuth, (req, res) => {
  const data = req.body;
  res.status(201).json({ created: true, data });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(3000, () => {
  console.log('Express running on port 3000');
});`,
    volten: `import { App } from 'volten';

const app = new App();

// Serve static files (built-in)
app.static('public');

// Auth middleware using ctx.state and ctx.cookies
const requireAuth = async (ctx, next) => {
  const token = ctx.cookies.authToken;
  if (!token) {
    return ctx.status(401).json({ error: 'Unauthorized' });
  }
  ctx.state.userId = 'user_123';
  await next();
};

// Routes with unified ctx
app.get('/api/profile', requireAuth, (ctx) => {
  return ctx.json({ userId: ctx.state.userId, name: 'Alice' });
});

app.post('/api/items', requireAuth, async (ctx) => {
  const data = await ctx.body();
  return ctx.status(201).json({ created: true, data });
});

// Global Error Handler (auto-catches unhandled errors & 404s)
app.onError((err, ctx) => {
  const status = err.statusCode || 500;
  return ctx.status(status).json({ error: err.message });
});

app.listen(3000, () => {
  console.log('Volten running on port 3000');
});`
  },
  {
    id: 'route',
    title: 'Basic Route',
    express: `const express = require('express');
const app = express();

app.get('/hello/:name', (req, res) => {
  const name = req.params.name;
  const greeting = req.query.greeting || 'Hello';
  res.json({ message: \`\${greeting}, \${name}!\` });
});

app.listen(3000);`,
    volten: `import { App } from 'volten';
const app = new App();

app.get('/hello/:name', (ctx) => {
  const name = ctx.params.name;
  const greeting = ctx.query.greeting || 'Hello';
  return ctx.json({ message: \`\${greeting}, \${name}!\` });
});

app.listen(3000);`
  },
  {
    id: 'body',
    title: 'Body Parsing',
    express: `const express = require('express');
const app = express();

// Requires external / global middleware
app.use(express.json());

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  res.status(201).json({ id: 1, name, email });
});`,
    volten: `import { App } from 'volten';
const app = new App();

// On-demand body parsing (zero extra middleware)
app.post('/api/users', async (ctx) => {
  const { name, email } = await ctx.body();
  return ctx.status(201).json({ id: 1, name, email });
});`
  },
  {
    id: 'middleware',
    title: 'Middleware & State',
    express: `const requireAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Mutating the untyped req object
  req.user = { id: 42, role: 'admin' };
  next();
};`,
    volten: `const requireAuth = async (ctx, next) => {
  const authHeader = ctx.headers['authorization'];
  if (!authHeader) {
    return ctx.status(401).json({ error: 'Unauthorized' });
  }
  // Isolated per-request state bag (recycled without leaks)
  ctx.state.user = { id: 42, role: 'admin' };
  await next();
};`
  }
]

const activeSnippetId = ref(props.initialSnippet)
const currentMode = ref<'express' | 'volten'>(props.initialMode)
const isPlaying = ref(false)
const highlighter = ref<any>(null)
const isHighlighterReady = ref(false)

const currentSnippet = computed(() => {
  return snippets.find((s) => s.id === activeSnippetId.value) || snippets[0]
})

const currentCode = computed(() => {
  return currentMode.value === 'express'
    ? currentSnippet.value.express
    : currentSnippet.value.volten
})

const activeTheme = computed(() => {
  return isDark.value ? 'github-dark' : 'github-light'
})

onMounted(async () => {
  try {
    const { createHighlighter } = await import('shiki')
    highlighter.value = await createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['javascript', 'typescript']
    })
    isHighlighterReady.value = true
  } catch (err) {
    console.error('Failed to initialize Shiki highlighter:', err)
  }
})

let playInterval: ReturnType<typeof setInterval> | null = null

function togglePlay() {
  if (isPlaying.value) {
    stopPlay()
  } else {
    startPlay()
  }
}

function startPlay() {
  isPlaying.value = true
  playInterval = setInterval(() => {
    currentMode.value = currentMode.value === 'express' ? 'volten' : 'express'
  }, 2200)
}

function stopPlay() {
  isPlaying.value = false
  if (playInterval) {
    clearInterval(playInterval)
    playInterval = null
  }
}

function setMode(mode: 'express' | 'volten') {
  stopPlay()
  currentMode.value = mode
}

function setSnippet(id: string) {
  activeSnippetId.value = id
}
</script>

<template>
  <div class="magic-move-container">
    <!-- Top Bar with Snippet Selector & Controls -->
    <div class="magic-move-header">
      <!-- Tabs for code snippets -->
      <div class="magic-move-tabs">
        <button
          v-for="s in snippets"
          :key="s.id"
          type="button"
          class="magic-tab-btn"
          :class="{ 'is-active': activeSnippetId === s.id }"
          @click="setSnippet(s.id)"
        >
          {{ s.title }}
        </button>
      </div>

      <!-- Controls: Express vs Volten toggle + Auto-Morph -->
      <div class="magic-move-controls">
        <div class="mode-toggle-group">
          <button
            type="button"
            class="mode-btn mode-express"
            :class="{ 'is-selected': currentMode === 'express' }"
            @click="setMode('express')"
          >
            <span class="mode-indicator" />
            Express (Before)
          </button>
          <button
            type="button"
            class="mode-btn mode-volten"
            :class="{ 'is-selected': currentMode === 'volten' }"
            @click="setMode('volten')"
          >
            <span class="mode-indicator" />
            Volten (After)
          </button>
        </div>

        <button
          type="button"
          class="play-btn"
          :class="{ 'is-playing': isPlaying }"
          :title="isPlaying ? 'Pause auto-morph' : 'Auto-animate morph between Express and Volten'"
          @click="togglePlay"
        >
          <svg v-if="!isPlaying" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M4 3.5v9l8-4.5-8-4.5z" />
          </svg>
          <svg v-else viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M4 3.5h3v9H4v-9zm5 0h3v9H9v-9z" />
          </svg>
          <span class="play-label">{{ isPlaying ? 'Pause' : 'Auto-Morph' }}</span>
        </button>
      </div>
    </div>

    <!-- Live Animated Code Area -->
    <div class="magic-move-body">
      <!-- Active Framework Banner Badge -->
      <div class="magic-move-status-bar">
        <span
          class="framework-pill"
          :class="currentMode === 'express' ? 'pill-express' : 'pill-volten'"
        >
          <span class="pill-dot" />
          {{ currentMode === 'express' ? 'Express 4.x / 5.x' : 'Volten 0.0.11 (Adaptive Engine)' }}
        </span>
        <span class="shiki-hint">Animated via <code>@shikijs/magic-move</code></span>
      </div>

      <!-- Magic Move Component -->
      <div class="magic-code-view">
        <ShikiMagicMove
          v-if="isHighlighterReady && highlighter"
          :highlighter="highlighter"
          :code="currentCode"
          lang="typescript"
          :theme="activeTheme"
          :options="{ duration: 750, stagger: 0.25, lineNumbers: true }"
          class="shiki-magic-move-block"
        />
        <!-- SSR / Loading fallback -->
        <pre v-else class="magic-fallback-code"><code>{{ currentCode }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.magic-move-container {
  margin: 1.75rem 0;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background-color: var(--vp-c-bg-alt);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  font-size: 14px;
}

.magic-move-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background-color: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.magic-move-tabs {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.magic-tab-btn {
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.3rem 0.65rem;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background-color: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.magic-tab-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
}

.magic-tab-btn.is-active {
  background-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.magic-move-controls {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.mode-toggle-group {
  display: inline-flex;
  padding: 2px;
  background-color: var(--vp-c-bg-mute);
  border-radius: 7px;
  border: 1px solid var(--vp-c-divider);
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.28rem 0.7rem;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-btn .mode-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--vp-c-text-3);
  transition: background-color 0.15s;
}

.mode-express.is-selected {
  background-color: var(--vp-c-bg);
  color: #eab308;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.mode-express.is-selected .mode-indicator {
  background-color: #eab308;
}

.mode-volten.is-selected {
  background-color: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.mode-volten.is-selected .mode-indicator {
  background-color: var(--vp-c-brand-1);
}

.play-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.3rem 0.65rem;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background-color: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: all 0.15s ease;
}

.play-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.play-btn.is-playing {
  background-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.magic-move-body {
  position: relative;
  background-color: var(--vp-c-bg);
}

.magic-move-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background-color: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 0.74rem;
}

.framework-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.15rem 0.55rem;
  border-radius: 9999px;
}

.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.pill-express {
  background-color: rgba(234, 179, 8, 0.12);
  color: #ca8a04;
  border: 1px solid rgba(234, 179, 8, 0.25);
}

:root.dark .pill-express {
  color: #facc15;
}

.pill-express .pill-dot {
  background-color: #eab308;
}

.pill-volten {
  background-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-soft);
}

.pill-volten .pill-dot {
  background-color: var(--vp-c-brand-1);
}

.shiki-hint {
  color: var(--vp-c-text-3);
  font-size: 0.72rem;
}

.shiki-hint code {
  font-size: inherit;
  color: var(--vp-c-text-2);
}

.magic-code-view {
  padding: 1rem 1.25rem;
  min-height: 360px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 0.86rem;
  line-height: 1.6;
}

:deep(.shiki-magic-move-container) {
  font-family: var(--vp-font-family-mono) !important;
  font-size: 0.86rem !important;
  line-height: 1.6 !important;
}

.magic-fallback-code {
  margin: 0;
  padding: 0;
  background: transparent !important;
  font-family: var(--vp-font-family-mono);
  font-size: 0.86rem;
  line-height: 1.6;
  white-space: pre;
}
</style>
