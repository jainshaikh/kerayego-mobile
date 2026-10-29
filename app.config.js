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
      bundleIdentifier: 'com.kerayego.app',
      icon: './assets/expo.icon',
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      package: 'com.kerayego.app',
      usesCleartextTraffic: true,
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
            'Allow $(PRODUCT_NAME) to use your location to show nearby vehicles and carpools, and to share your location with your driver until pickup.',
          // Two background location tasks, never both at once for one person
          // (src/features/liveRide/backgroundLocation): a carpool driver's
          // location keeps reaching their riders while a trip is in progress,
          // and a carpool rider's / rental customer's location keeps reaching
          // their driver while the backend's sharing window is open (until
          // pickup) — both while the app is in the background but still
          // running, with When-In-Use permission only (owner decisions):
          // - iOS: UIBackgroundModes 'location' (startLocationUpdatesAsync
          //   refuses to start without it), with the blue indicator.
          isIosBackgroundLocationEnabled: true,
          // - Android: FOREGROUND_SERVICE + FOREGROUND_SERVICE_LOCATION for the
          //   tasks' foreground services and their notifications ("Trip in
          //   progress" for the driver, "Sharing your location" for the
          //   customer) — required to start them on Android 14+; needs the
          //   Play Console foreground-service declaration.
          isAndroidForegroundServiceEnabled: true,
          // - Never ACCESS_BACKGROUND_LOCATION ("Allow all the time"): the
          //   foreground services don't need it, and sharing stops when the
          //   app is swiped away (both tasks use killServiceOnDestroy).
          isAndroidBackgroundLocationEnabled: false,
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
