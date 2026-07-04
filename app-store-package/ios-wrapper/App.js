import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

const APP_URL = "https://YOUR_RENDER_URL";

export default function App() {
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const allowedOrigin = useMemo(() => APP_URL.replace(/\/$/, ""), []);

  function reload() {
    setFailed(false);
    setLoading(true);
    webViewRef.current?.reload();
  }

  function shouldStartLoad(request) {
    const url = String(request.url || "");
    if (url === "about:blank") return true;
    if (url.startsWith(allowedOrigin)) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#020716" />
      <WebView
        ref={webViewRef}
        source={{ uri: APP_URL }}
        style={styles.webview}
        originWhitelist={["https://*"]}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState
        setSupportMultipleWindows={false}
        onLoadStart={() => {
          setLoading(true);
          setFailed(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 500) setFailed(true);
        }}
        onShouldStartLoadWithRequest={shouldStartLoad}
      />
      {loading && !failed ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color="#6ee7ff" />
          <Text style={styles.overlayText}>Loading Orbit Chat...</Text>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.error}>
          <Text style={styles.title}>Orbit Chat is unavailable</Text>
          <Text style={styles.message}>Check the server URL, internet connection, and Render service status.</Text>
          <Pressable style={styles.button} onPress={reload}>
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020716"
  },
  webview: {
    flex: 1,
    backgroundColor: "#020716"
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020716"
  },
  overlayText: {
    marginTop: 12,
    color: "#d8ebff",
    fontWeight: "700"
  },
  error: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#020716"
  },
  title: {
    color: "#eef8ff",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center"
  },
  message: {
    marginTop: 10,
    color: "#9bb5ca",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center"
  },
  button: {
    marginTop: 22,
    minHeight: 48,
    minWidth: 144,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f8cff"
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800"
  }
});
