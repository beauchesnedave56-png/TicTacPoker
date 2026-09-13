Les étapes à faire sur ton ordinateur (place manifest.json, icon-192.png, icon-512.png dans un dossier public/ à la racine du projet, et remplace les autres fichiers) :

npm install — installe Capacitor en plus du reste.
npx cap init — normalement pas nécessaire, capacitor.config.json est déjà prêt, mais si l'outil le redemande, réponds avec le même nom d'app et le même id.
npm run build — construit le dossier dist.
npx cap add android — génère le projet Android natif (dossier android/), une seule fois.
npm run android — (script que j'ai ajouté) rebuild + synchronise + ouvre Android Studio.
Dans Android Studio : Build → Build Bundle(s)/APK(s) → Build APK(s). L'APK debug apparaît dans android/app/build/outputs/apk/debug/.
Transfère ce fichier .apk sur les deux téléphones (câble, Drive, etc.) et installe-le — c'est là que ton mode développeur entre en jeu.

GitHub Action de release APK :
- Le workflow .github/workflows/android-release.yml construit automatiquement le projet Android, génère un APK et publie le fichier `TicTacPoker.apk` sur une GitHub Release.
- Le QR code pointe vers `https://github.com/beauchesnedave56-png/TicTacPoker/releases/latest/download/TicTacPoker.apk`.
- Pour lancer la publication manuellement : Actions → Android APK Release → Run workflow, puis saisir le tag (ex. `v1.0.0`).
- Pour un tag push, il suffit de créer un tag `v*.*.*` et le workflow publie l'APK automatiquement.