// screens/AuthScreen.js
// Compact Ocean-Themed Firebase Authentication — Lifts form above keyboard automatically

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  registerWithFirebase,
  loginWithFirebase,
} from '../firebase/config';
import { COLORS } from '../theme/colors';

export default function AuthScreen() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [loading, setLoading] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const scrollRef = useRef(null);
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 90, animated: true });
      }, 80);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleFieldFocus = (field, scrollY = 80) => {
    setFocusedField(field);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: scrollY, animated: true });
    }, 100);
  };

  const handleSubmit = async () => {
    Keyboard.dismiss();
    const trimEmail = email.trim();
    const trimPass = password.trim();
    const trimName = name.trim();

    if (!trimEmail || !trimPass) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    if (mode === 'register' && !trimName) {
      Alert.alert('Missing Name', 'Please enter your name to create an account.');
      return;
    }
    if (trimPass.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        await registerWithFirebase(trimName, trimEmail, trimPass);
      } else {
        await loginWithFirebase(trimEmail, trimPass);
      }
    } catch (err) {
      let msg = err?.message || 'Something went wrong. Please try again.';
      if (err.code === 'auth/email-already-in-use')
        msg = 'That email is already registered. Try signing in.';
      else if (err.code === 'auth/invalid-email')
        msg = 'Please enter a valid email address.';
      else if (err.code === 'auth/user-not-found')
        msg = 'No account found with this email. Please create an account first.';
      else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        msg = 'Incorrect email or password. Please try again.';
      else if (err.code === 'auth/too-many-requests')
        msg = 'Too many attempts. Please wait a moment and try again.';
      Alert.alert('Authentication Notice', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <StatusBar barStyle="light-content" backgroundColor="#083344" />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scroll,
          keyboardVisible && { paddingBottom: 160 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Compact Deep-Ocean Header (No orange logo, no feature pills) ── */}
        <View style={[styles.heroBanner, keyboardVisible && styles.heroBannerCompact]}>
          <View style={styles.bubbleLarge} />
          <View style={styles.bubbleMedium} />

          <Text style={styles.appName}>SmartFish Feeder</Text>
          {!keyboardVisible && (
            <Text style={styles.appTagline}>
              Intelligent IoT Aquarium Care & AI Disease Doctor
            </Text>
          )}
        </View>

        {/* ── Elevated Auth Form Card (Occupies top screen space) ── */}
        <View style={styles.cardWrap}>
          <View style={styles.card}>
            {/* Colorful Segmented Switcher */}
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tab, mode === 'login' && styles.tabActive]}
                onPress={() => setMode('login')}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="log-in-outline"
                  size={16}
                  color={mode === 'login' ? '#FFFFFF' : COLORS.textMid}
                />
                <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>
                  Sign In
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tab, mode === 'register' && styles.tabActive]}
                onPress={() => setMode('register')}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="person-add-outline"
                  size={15}
                  color={mode === 'register' ? '#FFFFFF' : COLORS.textMid}
                />
                <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>
                  Create Account
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.welcomeTitle}>
              {mode === 'login' ? 'Welcome Back! 👋' : 'Join SmartFish 🐠'}
            </Text>
            <Text style={styles.welcomeSub}>
              {mode === 'login'
                ? 'Sign in to monitor and feed your aquarium from anywhere.'
                : 'Create your account to link with your ESP8266 Smart Feeder.'}
            </Text>

            {/* Name field (register only) */}
            {mode === 'register' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>FULL NAME</Text>
                <View
                  style={[
                    styles.inputWrap,
                    focusedField === 'name' && styles.inputWrapFocused,
                  ]}
                >
                  <View style={[styles.iconBadge, { backgroundColor: '#E0F2FE' }]}>
                    <Ionicons name="person" size={16} color="#0284C7" />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Abhi"
                    placeholderTextColor={COLORS.textLight}
                    value={name}
                    onChangeText={setName}
                    onFocus={() => handleFieldFocus('name', 50)}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => emailInputRef.current?.focus()}
                  />
                </View>
              </View>
            )}

            {/* Email field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
              <View
                style={[
                  styles.inputWrap,
                  focusedField === 'email' && styles.inputWrapFocused,
                ]}
              >
                <View style={[styles.iconBadge, { backgroundColor: '#CCFBF1' }]}>
                  <Ionicons name="mail" size={16} color="#0D9488" />
                </View>
                <TextInput
                  ref={emailInputRef}
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={COLORS.textLight}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => handleFieldFocus('email', 90)}
                  onBlur={() => setFocusedField(null)}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
              </View>
            </View>

            {/* Password field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <View
                style={[
                  styles.inputWrap,
                  focusedField === 'password' && styles.inputWrapFocused,
                ]}
              >
                <View style={[styles.iconBadge, { backgroundColor: '#FFEDD5' }]}>
                  <Ionicons name="lock-closed" size={16} color="#EA580C" />
                </View>
                <TextInput
                  ref={passwordInputRef}
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Min. 6 characters"
                  placeholderTextColor={COLORS.textLight}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => handleFieldFocus('password', 150)}
                  onBlur={() => setFocusedField(null)}
                  secureTextEntry={!showPass}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <TouchableOpacity
                  onPress={() => setShowPass((v) => !v)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPass ? 'eye-off' : 'eye'}
                    size={18}
                    color={COLORS.teal}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Primary CTA Button */}
            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.75 }]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Text style={styles.submitText}>
                    {mode === 'login' ? 'Sign In to Aquarium' : 'Create My Account'}
                  </Text>
                  <Ionicons name="arrow-forward-circle" size={20} color="#FFF" />
                </>
              )}
            </TouchableOpacity>

            {/* Switch mode link */}
            <TouchableOpacity
              style={styles.switchRow}
              onPress={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setName('');
                setEmail('');
                setPassword('');
              }}
            >
              <Text style={styles.switchText}>
                {mode === 'login'
                  ? "Don't have an account yet? "
                  : 'Already have an account? '}
                <Text style={styles.switchLink}>
                  {mode === 'login' ? 'Create Account' : 'Sign In'}
                </Text>
              </Text>
            </TouchableOpacity>
          </View>

          {/* Bottom Cloud Sync Badge */}
          <View style={styles.footerBadge}>
            <Ionicons name="shield-checkmark" size={14} color={COLORS.teal} />
            <Text style={styles.footerBadgeText}>
              Secured by Firebase Authentication & Realtime Sync
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: 36,
  },
  // Compact Deep-Ocean Header
  heroBanner: {
    backgroundColor: '#083344',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 20 : 48,
    paddingBottom: 44,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
    position: 'relative',
  },
  heroBannerCompact: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 32,
    paddingBottom: 34,
  },
  bubbleLarge: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(6, 182, 212, 0.16)',
    top: -45,
    right: -35,
  },
  bubbleMedium: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(255, 90, 54, 0.14)',
    bottom: -35,
    left: -25,
  },
  appName: {
    fontSize: 25,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  appTagline: {
    fontSize: 12.5,
    color: '#BAE6FD',
    marginTop: 4,
    textAlign: 'center',
    fontWeight: '500',
  },

  // Card Container overlapping the hero header
  cardWrap: {
    paddingHorizontal: 18,
    marginTop: -26,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: 20,
    shadowColor: '#083344',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 6,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#F0F9FF',
    borderRadius: 15,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E0F2FE',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
  },
  tabActive: {
    backgroundColor: COLORS.teal,
    shadowColor: COLORS.teal,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  tabText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.textMid,
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  welcomeTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  welcomeSub: {
    fontSize: 12.5,
    color: COLORS.textLight,
    marginTop: 3,
    marginBottom: 14,
    lineHeight: 17,
  },
  fieldGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: COLORS.teal,
    letterSpacing: 0.8,
    marginBottom: 5,
    marginLeft: 2,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    height: 50,
  },
  inputWrapFocused: {
    borderColor: COLORS.tealLight,
    backgroundColor: '#FFFFFF',
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  eyeBtn: {
    padding: 8,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.coral,
    borderRadius: 15,
    paddingVertical: 14,
    marginTop: 6,
    shadowColor: COLORS.coral,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  submitText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15.5,
    letterSpacing: 0.3,
  },
  switchRow: {
    alignItems: 'center',
    marginTop: 14,
  },
  switchText: {
    fontSize: 13,
    color: COLORS.textMid,
    fontWeight: '500',
  },
  switchLink: {
    color: COLORS.coral,
    fontWeight: '800',
  },
  footerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  footerBadgeText: {
    fontSize: 11.5,
    color: COLORS.textMid,
    fontWeight: '600',
  },
});
