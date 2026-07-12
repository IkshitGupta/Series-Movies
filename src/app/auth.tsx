import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { hasSupabase, supabase } from '@/api/supabase';
import { useAuth, friendlyAuthError, validateUsername } from '@/store/useAuth';
import { COLORS } from '@/theme/colors';

type Mode = 'signin' | 'signup';

/**
 * Required-login gate. Users sign in (or sign up) with email + password. The
 * email can be any address (e.g. a Gmail address) — it's just the identifier;
 * the password is app-specific. On sign-up a **username** (display name) is also
 * collected and stored in the user's auth metadata. Email confirmation is
 * disabled server-side, so a successful sign-up logs the user straight in.
 */
export default function AuthScreen() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If Supabase isn't configured, don't trap the user on a login screen.
  if (!hasSupabase()) return <Redirect href="/(tabs)" />;
  // Once authenticated, the session-based redirect sends the user into the app.
  if (!loading && session) return <Redirect href="/(tabs)" />;

  const submit = async () => {
    const mail = email.trim();
    if (!mail || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    const uname = username.trim();
    if (mode === 'signup') {
      const usernameError = validateUsername(uname);
      if (usernameError) {
        setError(usernameError);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } =
        mode === 'signup'
          ? await supabase.auth.signUp({
              email: mail,
              password,
              options: { data: { username: uname } },
            })
          : await supabase.auth.signInWithPassword({ email: mail, password });
      if (authError) {
        setError(friendlyAuthError(authError.message, mode));
      }
      // On success the auth listener updates the session and this screen redirects.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black">
      <View className="flex-1 justify-center gap-6 px-6">
        <View className="items-center gap-3">
          <View
            className="h-20 w-20 items-center justify-center rounded-3xl"
            style={{ backgroundColor: COLORS.brand }}>
            <Ionicons name="film" size={40} color="white" />
          </View>
          <Text className="text-center text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            {isSignup ? 'Create your account' : 'Welcome back'}
          </Text>
          <Text className="text-center text-base text-neutral-500 dark:text-neutral-400">
            {isSignup
              ? 'Sign up to sync your library across devices.'
              : 'Sign in to access your synced library.'}
          </Text>
        </View>

        <View className="gap-3">
          {isSignup ? (
            <TextInput
              value={username}
              onChangeText={(t) => {
                setUsername(t);
                setError(null);
              }}
              placeholder="Username"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              textContentType="username"
              className="rounded-2xl bg-neutral-100 px-4 py-3.5 text-base text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50"
            />
          ) : null}
          <TextInput
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setError(null);
            }}
            placeholder="Email"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            className="rounded-2xl bg-neutral-100 px-4 py-3.5 text-base text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50"
          />
          <TextInput
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError(null);
            }}
            placeholder="Password"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            className="rounded-2xl bg-neutral-100 px-4 py-3.5 text-base text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50"
          />

          {error ? (
            <View className="flex-row items-center gap-1.5 px-1">
              <Ionicons name="alert-circle" size={15} color={COLORS.brand} />
              <Text className="flex-1 text-sm text-brand">{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={submit}
            disabled={busy}
            className="mt-1 h-14 flex-row items-center justify-center rounded-2xl active:opacity-80"
            style={{ backgroundColor: COLORS.brand, opacity: busy ? 0.7 : 1 }}>
            {busy ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text className="text-base font-semibold text-white">
                {isSignup ? 'Create account' : 'Sign in'}
              </Text>
            )}
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            setMode(isSignup ? 'signin' : 'signup');
            setError(null);
          }}
          className="active:opacity-70">
          <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            <Text className="font-semibold text-brand">{isSignup ? 'Sign in' : 'Sign up'}</Text>
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
