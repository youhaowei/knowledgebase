/// <reference types="vite/client" />

/**
 * Vite module declarations for CSS imports with ?url suffix
 */
declare module "*.css?url" {
  const url: string;
  export default url;
}
