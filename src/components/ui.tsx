// Small shared UI kit. Every interactive element has an accessibility role
// and label, and a minimum 44pt touch target.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNetInfo } from '@react-native-community/netinfo';
import { Image } from 'expo-image';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  type TextInputProps,
  type TextProps,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FontSize, Radius, Spacing, useTheme } from '@/constants/theme';
import { publicImageUrl } from '@/lib/media';

type IconName = ComponentProps<typeof Ionicons>['name'];

// ---- Layout ---------------------------------------------------------------
export function Screen({
  children,
  scroll = true,
  edges = ['top', 'bottom'],
  padded = true,
}: PropsWithChildren<{ scroll?: boolean; edges?: ('top' | 'bottom')[]; padded?: boolean }>) {
  const c = useTheme();
  const content = padded ? { padding: Spacing.lg, gap: Spacing.lg } : undefined;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.background }}>
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView contentContainerStyle={content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, content]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const c = useTheme();
  return (
    <View
      style={[
        { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.lg, gap: Spacing.md },
        style,
      ]}>
      {children}
    </View>
  );
}

// ---- Text -----------------------------------------------------------------
type Variant = 'hero' | 'title' | 'subtitle' | 'body' | 'caption' | 'label';
export function AppText({ variant = 'body', muted, style, ...rest }: TextProps & { variant?: Variant; muted?: boolean }) {
  const c = useTheme();
  const v: Record<Variant, object> = {
    hero: { fontSize: FontSize.hero, fontWeight: '700' },
    title: { fontSize: FontSize.title, fontWeight: '700' },
    subtitle: { fontSize: FontSize.subtitle, fontWeight: '600' },
    body: { fontSize: FontSize.body, lineHeight: 22 },
    caption: { fontSize: FontSize.caption, lineHeight: 18 },
    label: { fontSize: FontSize.caption, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  };
  return <Text style={[{ color: muted ? c.textSecondary : c.text }, v[variant], style]} {...rest} />;
}

// ---- Buttons ----------------------------------------------------------------
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const c = useTheme();
  const bg = { primary: c.primary, secondary: c.surfaceMuted, danger: c.danger, ghost: 'transparent' }[variant];
  const fg = { primary: c.primaryText, secondary: c.text, danger: '#FFFFFF', ghost: c.primary }[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: Radius.md,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
      })}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: FontSize.body, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

// ---- Inputs -----------------------------------------------------------------
export function TextField({
  label,
  error,
  hint,
  ...input
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: Spacing.xs }}>
      <AppText variant="caption" style={{ fontWeight: '600' }}>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textSecondary}
        style={{
          minHeight: 48,
          borderWidth: 1,
          borderColor: error ? c.danger : c.border,
          borderRadius: Radius.sm,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
          color: c.text,
          backgroundColor: c.surface,
          fontSize: FontSize.body,
        }}
        {...input}
      />
      {error ? (
        <AppText variant="caption" style={{ color: c.danger }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText style={{ fontWeight: '600' }}>{label}</AppText>
        {description ? (
          <AppText variant="caption" muted>
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: c.primary, false: c.border }}
      />
    </View>
  );
}

/** Single choice from a short list, rendered as wrapping chips. */
export function ChoiceChips<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: Spacing.sm }}>
      {label ? <AppText style={{ fontWeight: '600' }}>{label}</AppText> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }} accessibilityRole="radiogroup">
        {options.map((o) => (
          <Chip key={String(o.value)} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} disabled={disabled} radio />
        ))}
      </View>
    </View>
  );
}

/** Multiple choice chips. */
export function MultiChips({
  options,
  values,
  onChange,
}: {
  options: { value: string; label: string }[];
  values: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
      {options.map((o) => {
        const selected = values.includes(o.value);
        return (
          <Chip
            key={o.value}
            label={o.label}
            selected={selected}
            onPress={() => onChange(selected ? values.filter((v) => v !== o.value) : [...values, o.value])}
          />
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled,
  radio,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  radio?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={{ checked: !!selected, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={{
        minHeight: 36,
        paddingHorizontal: Spacing.md,
        justifyContent: 'center',
        borderRadius: Radius.pill,
        borderWidth: 1,
        borderColor: selected ? c.primary : c.border,
        backgroundColor: selected ? c.primaryMuted : c.surface,
        opacity: disabled ? 0.5 : 1,
      }}>
      <Text style={{ color: selected ? c.primary : c.text, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

export function Checkbox({ checked, onChange, children }: PropsWithChildren<{ checked: boolean; onChange: (v: boolean) => void }>) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', minHeight: 44 }}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? c.primary : c.textSecondary} />
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

// ---- Feedback ---------------------------------------------------------------
export function Banner({ tone = 'error', message, action }: { tone?: 'error' | 'warning' | 'info' | 'success'; message: string; action?: ReactNode }) {
  const c = useTheme();
  const colors = {
    error: { bg: c.dangerMuted, fg: c.danger, icon: 'alert-circle' as IconName },
    warning: { bg: c.warningMuted, fg: c.warning, icon: 'warning' as IconName },
    info: { bg: c.primaryMuted, fg: c.primary, icon: 'information-circle' as IconName },
    success: { bg: c.primaryMuted, fg: c.success, icon: 'checkmark-circle' as IconName },
  }[tone];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ backgroundColor: colors.bg, borderRadius: Radius.sm, padding: Spacing.md, flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }}>
      <Ionicons name={colors.icon} size={20} color={colors.fg} />
      <View style={{ flex: 1, gap: Spacing.sm }}>
        <Text style={{ color: colors.fg, fontSize: FontSize.body }}>{message}</Text>
        {action}
      </View>
    </View>
  );
}

export function OfflineBanner() {
  const net = useNetInfo();
  const c = useTheme();
  if (net.isConnected !== false) return null;
  return (
    <View style={{ backgroundColor: c.warningMuted, paddingVertical: 6, paddingHorizontal: Spacing.lg }} accessibilityLiveRegion="polite">
      <Text style={{ color: c.warning, textAlign: 'center' }}>You're offline. Changes can't be saved until you reconnect.</Text>
    </View>
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl, backgroundColor: c.background }}>
      <ActivityIndicator color={c.primary} size="large" />
      <AppText muted>{label}</AppText>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg }}>
      <Banner message={message} />
      {onRetry ? <Button title="Try again" onPress={onRetry} variant="secondary" icon="refresh" /> : null}
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message: string; action?: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: Spacing.xl, gap: Spacing.md }}>
      <View style={{ backgroundColor: c.primaryMuted, borderRadius: Radius.pill, padding: Spacing.lg }}>
        <Ionicons name={icon} size={32} color={c.primary} />
      </View>
      <AppText variant="subtitle" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText muted style={{ textAlign: 'center' }}>
        {message}
      </AppText>
      {action}
    </View>
  );
}

/** Clearly marks a feature that is not built yet, so nothing pretends to work. */
export function NotYetAvailable({ feature, stage, details }: { feature: string; stage: string; details: string }) {
  const c = useTheme();
  return (
    <Card style={{ borderStyle: 'dashed' }}>
      <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
        <Ionicons name="construct-outline" size={20} color={c.accent} />
        <AppText variant="label" style={{ color: c.accent }}>
          Not yet implemented · {stage}
        </AppText>
      </View>
      <AppText variant="subtitle">{feature}</AppText>
      <AppText muted>{details}</AppText>
    </Card>
  );
}

// ---- Lists & people -------------------------------------------------------------
export function ListRow({
  icon,
  label,
  detail,
  onPress,
  danger,
}: {
  icon?: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52, opacity: pressed ? 0.7 : 1 })}>
      {icon ? <Ionicons name={icon} size={22} color={danger ? c.danger : c.primary} /> : null}
      <View style={{ flex: 1 }}>
        <AppText style={{ color: danger ? c.danger : c.text }}>{label}</AppText>
        {detail ? (
          <AppText variant="caption" muted>
            {detail}
          </AppText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
    </Pressable>
  );
}

export function Avatar({ path, name, size = 48 }: { path?: string | null; name: string; size?: number }) {
  const c = useTheme();
  const url = publicImageUrl(path);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surfaceMuted }}
        accessibilityLabel={`${name}'s profile photo`}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View
      accessibilityLabel={`${name}'s initials`}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.primaryMuted, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.primary, fontWeight: '700', fontSize: size * 0.38 }}>{initials || '?'}</Text>
    </View>
  );
}

export function Divider() {
  const c = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}
