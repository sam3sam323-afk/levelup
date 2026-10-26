export {};

declare global {
  interface Window {
    nexusDesktop?: {
      readonly isElectron: true;
      readonly platform: string;
      openBrowser(language: "ar" | "en" | "fr"): Promise<boolean>;
      openDownload(id: string, action: "file" | "folder"): Promise<boolean>;
      openSupport(): Promise<void>;
      checkForUpdates(): Promise<{ ok: boolean; message?: string }>;
      installUpdate(): Promise<boolean>;
      onUpdateStatus(callback: (status: { state: string; message: string; percent?: number }) => void): () => void;
    };
  }
}
