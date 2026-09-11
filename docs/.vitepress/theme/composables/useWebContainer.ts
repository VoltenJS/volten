import { ref, computed, nextTick, onMounted, watch } from "vue";
import type { PlaygroundPreset } from "../data/playgroundPresets";

export function useWebContainer(
  presets: PlaygroundPreset[],
  initialPresetId: string,
  isDark: any,
  clickToLoad: boolean,
) {
  const activePresetId = ref(initialPresetId);
  const currentPreset = computed(() => {
    return presets.find((p) => p.id === activePresetId.value) || presets[0];
  });

  const containerRef = ref<HTMLDivElement | null>(null);
  const isLoading = ref(true);
  const isFullscreen = ref(false);
  const copiedCommand = ref(false);
  const errorMessage = ref<string | null>(null);
  const supportsEmbed = ref(true);
  let sdkModule: any = null;

  function detectEmbedSupport(): boolean {
    if (typeof window === "undefined") return false;
    const ua = navigator.userAgent;
    const isChromium =
      (/Chrome/.test(ua) && !/Edg/.test(ua)) ||
      /Edg/.test(ua) ||
      /Brave/.test(ua) ||
      /OPR/.test(ua);
    return isChromium || (window as any).crossOriginIsolated === true;
  }

  function getProjectPayload(preset: PlaygroundPreset) {
    return {
      title: `Volten - ${preset.name}`,
      description: preset.description,
      template: "node" as const,
      files: {
        "package.json": JSON.stringify(
          {
            name: "volten-playground",
            version: "1.0.0",
            type: "module",
            scripts: { start: "node index.js" },
            dependencies: { volten: "0.0.11" },
          },
          null,
          2,
        ),
        "index.js": preset.code,
        "README.md":
          "# ⚡ Volten Live WebContainer Playground\n\nRunning **Volten v0.0.11** in a simulated Node.js environment.\n\n### Quick Test Commands:\nRun in the terminal below:\n```bash\n" +
          preset.curlCommand +
          "\n```\n",
      },
    };
  }

  async function mountEmbed() {
    if (typeof window === "undefined") return;
    if (!containerRef.value) return;

    isLoading.value = true;
    errorMessage.value = null;

    try {
      if (!sdkModule) {
        const mod = await import("@stackblitz/sdk");
        sdkModule = mod.default || mod;
      }

      containerRef.value.innerHTML = "";
      const embedTarget = document.createElement("div");
      embedTarget.style.width = "100%";
      embedTarget.style.height = "100%";
      containerRef.value.appendChild(embedTarget);

      const project = getProjectPayload(currentPreset.value);

      await sdkModule.embedProject(embedTarget, project, {
        openFile: "index.js",
        terminalHeight: 44,
        theme: isDark.value ? "dark" : "light",
        clickToLoad,
        showSidebar: false,
        sidebarView: "project",
        height: "100%",
        crossOriginIsolated: true,
      });

      isLoading.value = false;
    } catch (err: any) {
      console.error("Failed to embed StackBlitz WebContainer:", err);
      errorMessage.value =
        err?.message ||
        "Could not initialize WebContainer. You can launch it directly in StackBlitz.";
      isLoading.value = false;
    }
  }

  function selectPreset(id: string) {
    if (activePresetId.value === id) return;
    activePresetId.value = id;
    if (supportsEmbed.value) {
      nextTick(() => mountEmbed());
    }
  }

  function reloadPlayground() {
    mountEmbed();
  }

  async function openInStackBlitz() {
    if (typeof window === "undefined") return;
    try {
      if (!sdkModule) {
        const mod = await import("@stackblitz/sdk");
        sdkModule = mod.default || mod;
      }
      const project = getProjectPayload(currentPreset.value);
      sdkModule.openProject(project, {
        openFile: "index.js",
        theme: isDark.value ? "dark" : "light",
      });
    } catch (e) {
      console.error("Could not open project in StackBlitz:", e);
    }
  }

  function copyCurlCommand() {
    if (typeof navigator === "undefined") return;
    navigator.clipboard.writeText(currentPreset.value.curlCommand).then(() => {
      copiedCommand.value = true;
      setTimeout(() => {
        copiedCommand.value = false;
      }, 2000);
    });
  }

  function toggleFullscreen() {
    isFullscreen.value = !isFullscreen.value;
  }

  onMounted(() => {
    supportsEmbed.value = detectEmbedSupport();
    if (supportsEmbed.value) {
      mountEmbed();
    } else {
      isLoading.value = false;
    }
  });

  watch(isDark, () => {
    if (supportsEmbed.value) {
      mountEmbed();
    }
  });

  return {
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
  };
}
