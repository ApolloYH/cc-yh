declare const MACRO: {
  VERSION: string
  BUILD_TIME?: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL?: string
  VERSION_CHANGELOG?: string
  FEEDBACK_CHANNEL?: string
  ISSUES_EXPLAINER?: string
}

declare module 'react/compiler-runtime' {
  export function c(...args: any[]): any
}

declare module 'audio-capture-napi' {
  const mod: any
  export = mod
}

declare module 'image-processor-napi' {
  const mod: any
  export = mod
}

declare module 'url-handler-napi' {
  const mod: any
  export = mod
}
