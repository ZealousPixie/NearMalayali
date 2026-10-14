// Date and time picker field. iOS shows one date-time spinner; Android
// shows the system date dialog followed by the time dialog.
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { formatEventTime } from '@/lib/format';

export function DateTimeField({
  label,
  value,
  onChange,
  minimumDate,
  placeholder = 'Choose date and time',
  onClear,
}: {
  label: string;
  value: Date | null;
  onChange: (d: Date) => void;
  minimumDate?: Date;
  placeholder?: string;
  onClear?: () => void;
}) {
  const c = useTheme();
  const [step, setStep] = useState<'closed' | 'date' | 'time' | 'ios'>('closed');
  const [pending, setPending] = useState<Date | null>(null);

  function open() {
    setPending(value ?? defaultStart());
    setStep(Platform.OS === 'ios' ? 'ios' : 'date');
  }

  function onAndroid(e: DateTimePickerEvent, d?: Date) {
    if (e.type !== 'set' || !d) {
      setStep('closed');
      return;
    }
    if (step === 'date') {
      const next = new Date(pending ?? d);
      next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      setPending(next);
      setStep('time');
    } else {
      const next = new Date(pending ?? d);
      next.setHours(d.getHours(), d.getMinutes(), 0, 0);
      setStep('closed');
      onChange(next);
    }
  }

  return (
    <View style={{ gap: Spacing.xs }}>
      <AppText variant="caption" style={{ fontWeight: '600' }}>
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? formatEventTime(value.toISOString()) : 'not set'}`}
          onPress={open}
          style={{
            flex: 1,
            minHeight: 48,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: Radius.sm,
            paddingHorizontal: Spacing.md,
            justifyContent: 'center',
            backgroundColor: c.surface,
          }}>
          <AppText muted={!value}>{value ? formatEventTime(value.toISOString()) : placeholder}</AppText>
        </Pressable>
        {value && onClear ? <Button title="Clear" variant="ghost" onPress={onClear} /> : null}
      </View>
      {step === 'ios' ? (
        <>
          <DateTimePicker
            value={pending ?? defaultStart()}
            mode="datetime"
            display="spinner"
            minimumDate={minimumDate}
            onChange={(_, d) => d && setPending(d)}
          />
          <Button
            title="Done"
            variant="secondary"
            onPress={() => {
              setStep('closed');
              if (pending) onChange(pending);
            }}
          />
        </>
      ) : null}
      {step === 'date' || step === 'time' ? (
        <DateTimePicker
          value={pending ?? defaultStart()}
          mode={step}
          minimumDate={step === 'date' ? minimumDate : undefined}
          onChange={onAndroid}
        />
      ) : null}
    </View>
  );
}

function defaultStart(): Date {
  const d = new Date(Date.now() + 86400_000);
  d.setHours(18, 0, 0, 0);
  return d;
}
