/// <reference types="vite/client" />

declare const chrome: {
  runtime: {
    sendMessage: (message: any) => Promise<any>;
  };
} | undefined;
