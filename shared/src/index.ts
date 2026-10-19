// The shared package: code used by BOTH the phone app and the website.
// Later phases add the protocol, encryption and chat logic here.
// For now it only holds one tiny function so we can check the wiring works.

export const PAKCHAT_NAME = "PakChat";

// Returns a greeting. App and website will both import this in later phases.
export function hello(name: string): string {
  return `Salam ${name}, welcome to ${PAKCHAT_NAME}`;
}
