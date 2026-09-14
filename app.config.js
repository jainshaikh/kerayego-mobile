module.exports = {
  expo: {
    name: 'KerayeGo',
    slug: 'kerayego-mobile',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'rentalmobile',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'com.rentalmobile.app',
      icon: './assets/expo.icon',
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      package: 'com.rentalmobile.app',
      googleServicesFile: './google-services.json',
      adaptiveIcon: {
        backgroundColor: '#FF4E64',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#FFF7F3',
          image: './assets/images/splash-icon.png',
          imageWidth: 180,
        },
      ],
      'expo-secure-store',
      '@react-native-community/datetimepicker',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow $(PRODUCT_NAME) to use your location to show nearby vehicles and carpools.',
        },
      ],
      [
        'expo-notifications',
        {
          // Monochrome (white-silhouette-on-transparent) is the asset Android
          // itself requires for status-bar notification icons — the same file
          // already built for the adaptive icon's monochrome layer works as-is.
          icon: './assets/images/android-icon-monochrome.png',
          color: '#FF4E64',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
