import { Text as NativeText, StyleSheet, type TextProps } from "react-native";

/** Keeps dense interface labels comfortably readable without shrinking larger headings. */
export function ReadableText(props: TextProps) {
  const flattened = StyleSheet.flatten(props.style);
  const originalSize = flattened?.fontSize;
  if (typeof originalSize !== "number" || originalSize >= 14) return <NativeText {...props} />;
  const fontSize = originalSize < 12 ? 12 : originalSize + 1;
  const originalLineHeight = typeof flattened?.lineHeight === "number" ? flattened.lineHeight : 0;
  const lineHeight = Math.max(originalLineHeight, Math.ceil(fontSize * 1.3));

  return <NativeText {...props} style={[props.style, { fontSize, lineHeight }]} />;
}
