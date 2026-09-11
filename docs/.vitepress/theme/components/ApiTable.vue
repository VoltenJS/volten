<script setup lang="ts">
import { ref, computed } from "vue";

export interface ApiProperty {
  name?: string;
  property?: string;
  type: string;
  default?: string | number | boolean | null;
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  badge?: string;
  badgeType?: "tip" | "info" | "warning" | "danger";
}

const props = withDefaults(
  defineProps<{
    items?: ApiProperty[];
    rows?: ApiProperty[];
    title?: string;
    description?: string;
    searchable?: boolean;
    placeholder?: string;
    propertyHeader?: string;
    typeHeader?: string;
    defaultHeader?: string;
    descriptionHeader?: string;
    compact?: boolean;
  }>(),
  {
    items: () => [],
    rows: () => [],
    title: "",
    description: "",
    searchable: true,
    placeholder: "Filter properties...",
    propertyHeader: "Property",
    typeHeader: "Type",
    defaultHeader: "Default",
    descriptionHeader: "Description",
    compact: false,
  },
);

const searchQuery = ref("");
const copiedProperty = ref<string | null>(null);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

const allItems = computed(() => {
  return props.items.length > 0 ? props.items : props.rows;
});

const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return allItems.value;

  return allItems.value.filter((item) => {
    const propName = (item.property || item.name || "").toLowerCase();
    const typeStr = (item.type || "").toLowerCase();
    const defaultStr = String(item.default ?? "").toLowerCase();
    const descStr = (item.description || "").toLowerCase();

    return (
      propName.includes(query) ||
      typeStr.includes(query) ||
      defaultStr.includes(query) ||
      descStr.includes(query)
    );
  });
});

function getPropName(item: ApiProperty): string {
  return item.property || item.name || "";
}

function formatDefaultValue(val: string | number | boolean | null | undefined): string {
  if (val === undefined || val === null || val === "") return "-";
  return String(val);
}

function copyToClipboard(text: string) {
  if (!text || typeof navigator === "undefined") return;
  navigator.clipboard.writeText(text).then(() => {
    copiedProperty.value = text;
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      copiedProperty.value = null;
    }, 1800);
  });
}

function formatDescription(text?: string): string {
  if (!text) return "";
  let safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="api-table-link">$1</a>');
  safe = safe.replace(/`([^`]+)`/g, '<code class="api-table-inline-code">$1</code>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return safe;
}
</script>

<template>
  <div class="api-table-container" :class="{ 'is-compact': compact }">
    <!-- Header bar with Title, Badge, and Search Filter -->
    <div
      v-if="title || description || (searchable && allItems.length > 2)"
      class="api-table-toolbar"
    >
      <div class="api-table-heading-group">
        <div v-if="title" class="api-table-title-row">
          <span class="api-table-title">{{ title }}</span>
          <span class="api-table-count-badge"
            >{{ filteredItems.length }}
            {{ filteredItems.length === 1 ? "property" : "properties" }}</span
          >
        </div>
        <p v-if="description" class="api-table-subtitle">{{ description }}</p>
      </div>

      <div v-if="searchable && allItems.length > 2" class="api-table-search-box">
        <svg class="search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor">
          <circle cx="8.5" cy="8.5" r="5.5" stroke-width="1.6" />
          <path d="M12.5 12.5L16.5 16.5" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="placeholder"
          class="search-input"
          aria-label="Filter properties"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="clear-search-btn"
          aria-label="Clear filter"
          @click="searchQuery = ''"
        >
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor">
            <path d="M2 2L12 12M12 2L2 12" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Desktop & Tablet Table Layout -->
    <div class="api-table-wrapper">
      <table class="api-table-grid">
        <thead>
          <tr>
            <th class="col-property">{{ propertyHeader }}</th>
            <th class="col-type">{{ typeHeader }}</th>
            <th class="col-default">{{ defaultHeader }}</th>
            <th class="col-description">{{ descriptionHeader }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filteredItems"
            :key="getPropName(item)"
            class="api-table-row"
            :class="{ 'is-deprecated': item.deprecated }"
          >
            <!-- Property Column -->
            <td class="col-property">
              <div class="property-cell-wrapper">
                <button
                  type="button"
                  class="property-name-badge"
                  :title="'Click to copy \'' + getPropName(item) + '\''"
                  @click="copyToClipboard(getPropName(item))"
                >
                  <code>{{ getPropName(item) }}</code>
                  <span class="copy-indicator">
                    <svg
                      v-if="copiedProperty === getPropName(item)"
                      class="check-icon"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path
                        d="M3.5 8.5L6.5 11.5L12.5 4.5"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                    <svg
                      v-else
                      class="copy-icon"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                    >
                      <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" stroke-width="1.5" />
                      <path
                        d="M10.5 3.5H4.5C3.94772 3.5 3.5 3.94772 3.5 4.5V10.5"
                        stroke-width="1.5"
                        stroke-linecap="round"
                      />
                    </svg>
                  </span>
                </button>

                <!-- Badges -->
                <div v-if="item.required || item.deprecated || item.badge" class="badge-list">
                  <span v-if="item.required" class="prop-badge badge-required">Required</span>
                  <span v-if="item.deprecated" class="prop-badge badge-deprecated">Deprecated</span>
                  <span
                    v-if="item.badge"
                    class="prop-badge"
                    :class="'badge-' + (item.badgeType || 'info')"
                  >
                    {{ item.badge }}
                  </span>
                </div>
              </div>
            </td>

            <!-- Type Column -->
            <td class="col-type">
              <div class="type-cell">
                <code class="type-badge" :title="item.type">{{ item.type }}</code>
              </div>
            </td>

            <!-- Default Column -->
            <td class="col-default">
              <div class="default-cell">
                <code v-if="formatDefaultValue(item.default) !== '-'" class="default-badge">
                  {{ formatDefaultValue(item.default) }}
                </code>
                <span v-else class="default-dash">-</span>
              </div>
            </td>

            <!-- Description Column -->
            <td class="col-description">
              <div class="description-cell">
                <slot name="description" :item="item">
                  <span v-html="formatDescription(item.description)"></span>
                </slot>
              </div>
            </td>
          </tr>

          <!-- Empty Search State -->
          <tr v-if="filteredItems.length === 0" class="api-table-empty-row">
            <td colspan="4" class="empty-message-cell">
              <div class="empty-state-box">
                <p>
                  No properties match "<strong>{{ searchQuery }}</strong
                  >"
                </p>
                <button type="button" class="reset-filter-btn" @click="searchQuery = ''">
                  Clear search
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile Stacked Card View -->
    <div class="api-mobile-cards">
      <div
        v-for="item in filteredItems"
        :key="'mobile-' + getPropName(item)"
        class="api-mobile-card"
        :class="{ 'is-deprecated': item.deprecated }"
      >
        <div class="mobile-card-header">
          <div class="mobile-title-row">
            <button
              type="button"
              class="property-name-badge"
              @click="copyToClipboard(getPropName(item))"
            >
              <code>{{ getPropName(item) }}</code>
              <span class="copy-indicator">
                <svg
                  v-if="copiedProperty === getPropName(item)"
                  class="check-icon"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    d="M3.5 8.5L6.5 11.5L12.5 4.5"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <svg v-else class="copy-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor">
                  <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" stroke-width="1.5" />
                  <path
                    d="M10.5 3.5H4.5C3.94772 3.5 3.5 3.94772 3.5 4.5V10.5"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                </svg>
              </span>
            </button>
            <div v-if="item.required || item.deprecated || item.badge" class="badge-list">
              <span v-if="item.required" class="prop-badge badge-required">Required</span>
              <span v-if="item.deprecated" class="prop-badge badge-deprecated">Deprecated</span>
              <span
                v-if="item.badge"
                class="prop-badge"
                :class="'badge-' + (item.badgeType || 'info')"
                >{{ item.badge }}</span
              >
            </div>
          </div>
        </div>

        <div class="mobile-meta-grid">
          <div class="mobile-meta-item">
            <span class="mobile-meta-label">Type</span>
            <code class="type-badge">{{ item.type }}</code>
          </div>
          <div class="mobile-meta-item">
            <span class="mobile-meta-label">Default</span>
            <code v-if="formatDefaultValue(item.default) !== '-'" class="default-badge">
              {{ formatDefaultValue(item.default) }}
            </code>
            <span v-else class="default-dash">-</span>
          </div>
        </div>

        <div class="mobile-description">
          <slot name="description" :item="item">
            <span v-html="formatDescription(item.description)"></span>
          </slot>
        </div>
      </div>

      <div v-if="filteredItems.length === 0" class="empty-state-box mobile-empty">
        <p>
          No properties match "<strong>{{ searchQuery }}</strong
          >"
        </p>
        <button type="button" class="reset-filter-btn" @click="searchQuery = ''">
          Clear search
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.api-table-container {
  width: 100%;
  margin: 1.5rem 0;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background-color: var(--vp-c-bg);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 4px 12px rgba(0, 0, 0, 0.02);
  overflow: hidden;
  font-size: 14px;
}

/* Toolbar */
.api-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.85rem 1.25rem;
  background-color: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.api-table-heading-group {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.api-table-title-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.api-table-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--vp-c-text-1);
}

.api-table-count-badge {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background-color: var(--vp-c-bg-mute);
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  border: 1px solid var(--vp-c-divider);
}

.api-table-subtitle {
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
  margin: 0;
}

/* Search input */
.api-table-search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.65rem;
  width: 14px;
  height: 14px;
  color: var(--vp-c-text-3);
  pointer-events: none;
}

.search-input {
  padding: 0.35rem 1.8rem 0.35rem 2rem;
  font-size: 0.82rem;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background-color: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  width: 190px;
}

.search-input:focus {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 2px var(--vp-c-brand-soft);
}

.clear-search-btn {
  position: absolute;
  right: 0.5rem;
  background: none;
  border: none;
  padding: 0.2rem;
  cursor: pointer;
  color: var(--vp-c-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-search-btn:hover {
  color: var(--vp-c-text-1);
}

/* Table */
.api-table-wrapper {
  display: block;
  overflow-x: auto;
  width: 100%;
}

.api-table-grid {
  display: table !important;
  width: 100% !important;
  border-collapse: collapse !important;
  text-align: left;
  margin: 0 !important;
  table-layout: auto; /* Adapts dynamically to content */
}

/* Header Cells */
.api-table-grid thead tr {
  background-color: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.api-table-grid th {
  padding: 0.75rem 1rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  border: none;
}

/* Data Cells */
.api-table-grid td {
  padding: 0.9rem 1rem;
  border-top: none;
  border-left: none;
  border-right: none;
  border-bottom: 1px solid var(--vp-c-divider);
  vertical-align: top;
  font-size: 0.85rem;
}

.api-table-row {
  transition: background-color 0.15s ease;
}

.api-table-row:hover {
  background-color: var(--vp-c-bg-soft);
}

.api-table-row:last-child td {
  border-bottom: none;
}

.is-deprecated {
  opacity: 0.65;
}

.is-deprecated code {
  text-decoration: line-through;
}

/* Column Rules: Metadata shrinks to content, Description takes the rest */
.col-property,
.col-type,
.col-default {
  width: 1%;
  white-space: nowrap;
}

.col-description {
  width: 100%;
  min-width: 260px;
}

/* Property Cell */
.property-cell-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: flex-start;
  white-space: nowrap;
}

.property-name-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border: 1px solid transparent;
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
  font-weight: 600;
  transition: all 0.15s ease;
  text-align: left;
  white-space: nowrap;
}

.property-name-badge code {
  background: transparent !important;
  color: inherit !important;
  padding: 0 !important;
  font-size: inherit;
  font-weight: inherit;
  white-space: nowrap;
}

.property-name-badge:hover {
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
}

.copy-indicator {
  display: inline-flex;
  align-items: center;
  color: var(--vp-c-brand-1);
  opacity: 0.6;
}

.property-name-badge:hover .copy-indicator {
  opacity: 1;
}

.copy-icon,
.check-icon {
  width: 12px;
  height: 12px;
}

.check-icon {
  color: #10b981;
}

/* Badges */
.badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  white-space: nowrap;
}

.prop-badge {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.08rem 0.38rem;
  border-radius: 4px;
  white-space: nowrap;
}

.badge-required {
  background-color: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.badge-deprecated {
  background-color: rgba(100, 116, 139, 0.15);
  color: #64748b;
  border: 1px solid rgba(100, 116, 139, 0.25);
}

.badge-tip,
.badge-info {
  background-color: rgba(14, 165, 233, 0.12);
  color: #0284c7;
  border: 1px solid rgba(14, 165, 233, 0.25);
}

.badge-warning {
  background-color: rgba(245, 158, 11, 0.15);
  color: #d97706;
  border: 1px solid rgba(245, 158, 11, 0.25);
}

/* Type Cell */
.type-cell {
  white-space: nowrap;
}

.type-badge {
  display: inline-block;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: #0284c7;
  background-color: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(14, 165, 233, 0.18);
  padding: 0.18rem 0.45rem;
  border-radius: 5px;
  white-space: nowrap;
}

:root.dark .type-badge {
  color: #38bdf8;
  background-color: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.22);
}

/* Default Cell */
.default-cell {
  white-space: nowrap;
}

.default-badge {
  display: inline-block;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
  background-color: var(--vp-c-bg-mute);
  border: 1px solid var(--vp-c-divider);
  padding: 0.15rem 0.45rem;
  border-radius: 5px;
  white-space: nowrap;
}

.default-dash {
  color: var(--vp-c-text-3);
  font-weight: 500;
}

/* Description Cell */
.description-cell {
  color: var(--vp-c-text-1);
  line-height: 1.6;
  font-size: 0.86rem;
  word-break: normal;
  overflow-wrap: break-word;
}

:deep(.api-table-inline-code) {
  font-family: var(--vp-font-family-mono);
  font-size: 0.82em;
  padding: 0.12rem 0.35rem;
  border-radius: 4px;
  background-color: var(--vp-c-bg-mute);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
  white-space: nowrap;
}

:deep(.api-table-link) {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 2px;
  font-weight: 500;
}

:deep(.api-table-link:hover) {
  color: var(--vp-c-brand-2);
}

/* Empty State */
.empty-message-cell {
  text-align: center;
  padding: 2.5rem 1rem !important;
}

.empty-state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  color: var(--vp-c-text-2);
}

.reset-filter-btn {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
}

/* Mobile cards - hidden on desktop */
.api-mobile-cards {
  display: none;
}

@media (max-width: 768px) {
  .api-table-wrapper {
    display: none;
  }

  .api-mobile-cards {
    display: flex;
    flex-direction: column;
    divide-y: 1px solid var(--vp-c-divider);
  }

  .api-mobile-card {
    padding: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border-bottom: 1px solid var(--vp-c-divider);
  }

  .api-mobile-card:last-child {
    border-bottom: none;
  }

  .mobile-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .mobile-meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    background-color: var(--vp-c-bg-soft);
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    border: 1px solid var(--vp-c-divider);
  }

  .mobile-meta-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .mobile-meta-label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--vp-c-text-3);
    letter-spacing: 0.05em;
  }

  .mobile-description {
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--vp-c-text-1);
  }

  .mobile-empty {
    padding: 2rem 1rem;
  }
}
</style>
