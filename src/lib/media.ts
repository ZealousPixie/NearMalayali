// Picking, resizing and uploading profile images.
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

const BUCKET = 'profile-media';
const MAX_BYTES = 5 * 1024 * 1024;

export type ImageKind = 'avatar' | 'cover';

/** Opens the photo library. Returns null if the person cancels. */
export async function pickImage(kind: ImageKind): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('PHOTO_PERMISSION_DENIED');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: kind === 'avatar' ? [1, 1] : [3, 1],
    quality: 1,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0].uri;
}

/**
 * Resizes to a sensible size, re-encodes as JPEG (which also strips EXIF data
 * such as GPS coordinates), uploads to the member's own folder and returns
 * the storage path.
 */
export async function uploadProfileImage(userId: string, localUri: string, kind: ImageKind): Promise<string> {
  const width = kind === 'avatar' ? 512 : 1500;
  const context = ImageManipulator.ImageManipulator.manipulate(localUri);
  context.resize({ width });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });

  const body = await fetch(saved.uri).then((r) => r.arrayBuffer());
  if (body.byteLength > MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');

  const path = `${userId}/${kind}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function removeProfileImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export function publicImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
