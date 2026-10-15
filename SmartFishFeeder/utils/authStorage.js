// utils/authStorage.js — Permanent Auth Session Storage
// Persists user login permanently across app restarts, closures, and reboots.
// Multi-layer persistence:
// 1. Android SharedPreferences (NativeModule FishDiseaseDetector) — 100% native on device
// 2. Expo SecureStore / FileSystem (if running via Expo Go)
// 3. Metro Dev Server session endpoint (/api/auth-session)
// 4. In-memory / localStorage fallback

import { NativeModules } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { getMetroApiUrl } from './fishVisionDetector';

const STORAGE_KEY = 'smart_fish_feeder_user_session';
let memoryUser = null;

function getAuthSessionEndpoint() {
  try {
    const base = getMetroApiUrl();
    if (base && typeof base === 'string') {
      return base.replace('/api/fish-disease-detect', '/api/auth-session');
    }
  } catch (e) {}
  return 'http://10.226.195.103:8081/api/auth-session';
}

/**
 * Permanently saves the authenticated user session
 */
export async function saveStoredUser(user) {
  if (!user) return;
  memoryUser = user;
  const json = JSON.stringify(user);

  // 1. Android Native SharedPreferences (100% native permanent storage on device)
  try {
    const detector = NativeModules?.FishDiseaseDetector;
    if (detector && typeof detector.saveUser === 'function') {
      await detector.saveUser(json);
    }
  } catch (e) {}

  // 2. Expo SecureStore (if available)
  try {
    const ExpoSecureStore = requireOptionalNativeModule('ExpoSecureStore');
    if (ExpoSecureStore && typeof ExpoSecureStore.setValueWithKeyAsync === 'function') {
      await ExpoSecureStore.setValueWithKeyAsync(json, STORAGE_KEY);
    }
  } catch (e) {}

  // 3. LocalStorage (Web environment)
  try {
    if (typeof global !== 'undefined' && global.localStorage) {
      global.localStorage.setItem(STORAGE_KEY, json);
    }
  } catch (e) {}

  // 4. Metro Dev Server (/api/auth-session on laptop disk)
  try {
    const endpoint = getAuthSessionEndpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (e) {}
}

/**
 * Retrieves the permanently saved user session
 */
export async function getStoredUser() {
  if (memoryUser) return memoryUser;

  // 1. Try Android Native SharedPreferences
  try {
    const detector = NativeModules?.FishDiseaseDetector;
    if (detector && typeof detector.getUser === 'function') {
      const raw = await detector.getUser();
      if (raw && typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.uid || parsed.email)) {
          memoryUser = parsed;
          return parsed;
        }
      }
    }
  } catch (e) {}

  // 2. Try Expo SecureStore
  try {
    const ExpoSecureStore = requireOptionalNativeModule('ExpoSecureStore');
    if (ExpoSecureStore && typeof ExpoSecureStore.getValueWithKeyAsync === 'function') {
      const raw = await ExpoSecureStore.getValueWithKeyAsync(STORAGE_KEY);
      if (raw && typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.uid || parsed.email)) {
          memoryUser = parsed;
          return parsed;
        }
      }
    }
  } catch (e) {}

  // 3. Try LocalStorage (Web)
  try {
    if (typeof global !== 'undefined' && global.localStorage) {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.uid || parsed.email)) {
          memoryUser = parsed;
          return parsed;
        }
      }
    }
  } catch (e) {}

  // 4. Try Metro Dev Server (/api/auth-session)
  try {
    const endpoint = getAuthSessionEndpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const u = data?.user || (data?.uid ? data : null);
      if (u && (u.uid || u.email)) {
        memoryUser = u;
        return u;
      }
    }
  } catch (e) {}

  return null;
}

/**
 * Clears the stored user session upon sign out
 */
export async function clearStoredUser() {
  memoryUser = null;

  // 1. Clear Android Native SharedPreferences
  try {
    const detector = NativeModules?.FishDiseaseDetector;
    if (detector && typeof detector.clearUser === 'function') {
      await detector.clearUser();
    }
  } catch (e) {}

  // 2. Clear Expo SecureStore
  try {
    const ExpoSecureStore = requireOptionalNativeModule('ExpoSecureStore');
    if (ExpoSecureStore && typeof ExpoSecureStore.deleteValueWithKeyAsync === 'function') {
      await ExpoSecureStore.deleteValueWithKeyAsync(STORAGE_KEY);
    }
  } catch (e) {}

  // 3. Clear LocalStorage
  try {
    if (typeof global !== 'undefined' && global.localStorage) {
      global.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {}

  // 4. Clear Metro Dev Server session
  try {
    const endpoint = getAuthSessionEndpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    await fetch(endpoint, {
      method: 'DELETE',
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (e) {}
}

