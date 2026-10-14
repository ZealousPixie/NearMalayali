import { friendlyError } from '../errors';
import {
  ageOn,
  firstError,
  isEligibleAge,
  parseTags,
  passwordSchema,
  toIsoDate,
  usernameSchema,
} from '../validation';

describe('age eligibility', () => {
  const today = new Date(2026, 9, 14); // 14 Oct 2026

  it('counts a birthday later this year as not yet reached', () => {
    expect(ageOn(new Date(2008, 9, 15), today)).toBe(17);
    expect(isEligibleAge(new Date(2008, 9, 15), today)).toBe(false);
  });

  it('accepts someone turning 18 today', () => {
    expect(isEligibleAge(new Date(2008, 9, 14), today)).toBe(true);
  });

  it('formats dates without shifting to UTC', () => {
    expect(toIsoDate(new Date(1990, 0, 5))).toBe('1990-01-05');
  });
});

describe('usernames', () => {
  it('normalises case and a leading @', () => {
    expect(usernameSchema.parse('@Kiran_96')).toBe('kiran_96');
  });

  it('rejects spaces and short names', () => {
    expect(firstError(usernameSchema, 'ab')).not.toBeNull();
    expect(firstError(usernameSchema, 'has space')).not.toBeNull();
  });
});

describe('passwords', () => {
  it('needs letters and numbers', () => {
    expect(firstError(passwordSchema, 'abcdefgh')).toBe('Use both letters and numbers.');
    expect(firstError(passwordSchema, 'abcd1234')).toBeNull();
  });
});

describe('tags', () => {
  it('trims, de-duplicates and caps the list', () => {
    expect(parseTags(' Cricket, cricket ,Cooking,, Music', 2)).toEqual(['Cricket', 'Cooking']);
  });
});

describe('friendlyError', () => {
  it('maps server codes', () => {
    expect(friendlyError({ message: 'USERNAME_TAKEN' })).toBe('That username is already taken.');
  });

  it('maps auth messages', () => {
    expect(friendlyError(new Error('Invalid login credentials'))).toBe('Email or password is incorrect.');
  });

  it('never leaks raw internals', () => {
    expect(friendlyError(new Error('relation "x" does not exist'))).toBe('Something went wrong. Please try again.');
  });
});
