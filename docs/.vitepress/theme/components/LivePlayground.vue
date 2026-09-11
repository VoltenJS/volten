<script setup lang="ts">
import { useData } from "vitepress";
import { presets } from "../data/playgroundPresets";
import { useWebContainer } from "../composables/useWebContainer";

const props = withDefaults(
  defineProps<{
    initialPreset?: string;
    height?: string;
    title?: string;
    clickToLoad?: boolean;
  }>(),
  {
    initialPreset: "basic",
    height: "620px",
    title: "Volten Interactive Playground",
    clickToLoad: false,
  },
);

const { isDark } = useData();

const {
  activePresetId,
  currentPreset,
  containerRef,
  isLoading,
  isFullscreen,
  copiedCommand,
  errorMessage,
  supportsEmbed,
  selectPreset,
  reloadPlayground,
  openInStackBlitz,
  copyCurlCommand,
  toggleFullscreen,
} = useWebContainer(presets, props.initialPreset, isDark, props.clickToLoad);
</script>

<template>
  <div
    class="live-playground-container"
    :class="{ 'is-fullscreen': isFullscreen }"
    :style="{ '--playground-height': height }"
  >
    <!-- Top Chrome Window Bar -->
    <div class="playground-chrome">
      <!-- Traffic Light Dots -->
      <div class="chrome-window-dots">
        <span class="dot dot-close" />
        <span class="dot dot-minimize" />
        <span class="dot dot-maximize" @click="toggleFullscreen" />
      </div>

      <!-- Environment & Status Pill -->
      <div class="chrome-status-badge">
        <span class="pulse-indicator" :class="{ 'is-loading': isLoading }" />
        <span class="badge-text">Node.js WebContainer</span>
        <span class="badge-divider">•</span>
        <span class="badge-version">Volten v0.0.11</span>
      </div>

      <!-- Actions (Reload, Open External, Fullscreen) -->
      <div class="chrome-actions">
        <button
          type="button"
          class="chrome-btn"
          title="Reload environment"
          aria-label="Reload environment"
          @click="reloadPlayground"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor">
            <path
              d="M13.6 8A5.6 5.6 0 1 1 12 4.04L13.8 2.2V6.2H9.8L11.4 4.6A4 4 0 1 0 12 8"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="btn-label">Reload</span>
        </button>

        <button
          type="button"
          class="chrome-btn btn-primary"
          title="Open in StackBlitz full screen tab"
          @click="openInStackBlitz"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor">
            <path
              d="M6 3H3C2.44772 3 2 3.44772 2 4V13C2 13.5523 2.44772 14 3 14H12C12.5523 14 13 13.5523 13 13V10M9 3H14M14 3V8M14 3L6.5 10.5"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="btn-label">Open in StackBlitz</span>
        </button>

        <button
          type="button"
          class="chrome-btn icon-only"
          :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
          @click="toggleFullscreen"
        >
          <svg
            v-if="!isFullscreen"
            viewBox="0 0 16 16"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M2 6V2H6M10 2H14V6M14 10V14H10M6 14H2V10"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <svg v-else viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor">
            <path
              d="M6 2V6H2M14 6H10V2M10 14V10H14M2 10H6V14"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Presets Bar -->
    <div class="playground-presets-bar">
      <div class="preset-tabs">
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          class="preset-tab-btn"
          :class="{ 'is-active': activePresetId === preset.id }"
          @click="selectPreset(preset.id)"
        >
          {{ preset.name }}
        </button>
      </div>
      <div class="preset-description">
        {{ currentPreset.description }}
      </div>
    </div>

    <!-- Live Embed Viewport (Chromium) -->
    <div v-if="supportsEmbed" class="playground-viewport">
      <!-- Loading Skeleton Overlay -->
      <div v-if="isLoading" class="playground-loader-overlay">
        <div class="loader-content">
          <div class="loader-spinner">
            <span class="spinner-ring" />
            <span class="spinner-bolt">⚡</span>
          </div>
          <h4 class="loader-title">Booting Node.js WebContainer</h4>
          <p class="loader-subtitle">Loading Volten 0.0.11 runtime &amp; server dependencies...</p>
        </div>
      </div>

      <!-- Error Fallback -->
      <div v-if="errorMessage" class="playground-error-overlay">
        <div class="error-box">
          <div class="error-icon">⚠️</div>
          <h4>Embedded WebContainer Notice</h4>
          <p>{{ errorMessage }}</p>
          <div class="error-actions">
            <button type="button" class="btn-primary" @click="openInStackBlitz">
              Open in StackBlitz Tab
            </button>
            <button type="button" class="btn-secondary" @click="reloadPlayground">
              Retry Embed
            </button>
          </div>
        </div>
      </div>

      <!-- Actual StackBlitz Container -->
      <div ref="containerRef" class="embed-inner" />
    </div>

    <!-- Safari/Firefox Fallback: Code Preview -->
    <div v-else class="playground-viewport safari-fallback">
      <div class="safari-code-preview">
        <div class="code-header">
          <span class="code-filename">index.js</span>
          <span class="code-lang">JavaScript</span>
        </div>
        <pre class="code-block"><code>{{ currentPreset.code }}</code></pre>
      </div>
      <div class="safari-launch-bar">
        <div class="safari-notice">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            style="flex-shrink: 0"
          >
            <circle cx="12" cy="12" r="10" stroke-width="2" />
            <path d="M12 8v4M12 16h.01" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span
            >WebContainer embeds require a Chromium browser. Click below to run this code live in a
            new tab.</span
          >
        </div>
        <button type="button" class="safari-launch-btn" @click="openInStackBlitz">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
            <path
              d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
          Open in StackBlitz
        </button>
      </div>
    </div>

    <!-- Quick Curl Command Bar -->
    <div class="playground-quick-curl">
      <span class="curl-label">Test in Terminal:</span>
      <code class="curl-code">{{ currentPreset.curlCommand }}</code>
      <button
        type="button"
        class="copy-curl-btn"
        :title="copiedCommand ? 'Copied!' : 'Copy command'"
        @click="copyCurlCommand"
      >
        <svg
          v-if="copiedCommand"
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="#10b981"
        >
          <path
            d="M3.5 8.5L6.5 11.5L12.5 4.5"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor">
          <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" stroke-width="1.5" />
          <path
            d="M10.5 3.5H4.5C3.94772 3.5 3.5 3.94772 3.5 4.5V10.5"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <span class="copy-text">{{ copiedCommand ? "Copied" : "Copy" }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped src="./LivePlayground.css"></style>
