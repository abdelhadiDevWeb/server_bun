# Implémentation des Notifications Push - Résumé Complet

## ✅ Modifications Effectuées

### 1. Installation de la Dépendance
- **Fichier**: `package.json`
- **Modification**: Ajout de `"expo-server-sdk": "^3.7.0"` dans les dependencies
- **Action requise**: Exécuter `npm install` ou `bun install` pour installer le package

### 2. Modification du Modèle User
- **Fichier**: `Models/User.ts`
- **Champs ajoutés**:
  - `pushToken`: String (token Expo Push)
  - `platform`: Enum ['ios', 'android']
  - `deviceId`: String (ID du device)
  - `pushTokenUpdatedAt`: Date (date de dernière mise à jour)

### 3. Modification du Modèle Workshop
- **Fichier**: `Models/Workshop.ts`
- **Champs ajoutés**: Mêmes champs que User pour permettre aux workshops de recevoir des notifications push

### 4. Création du Service Push Notification
- **Fichier**: `services/pushNotificationService.ts` (NOUVEAU)
- **Fonctions**:
  - `sendPushNotification(userId, title, body, data)`: Envoie une notification push à un utilisateur
  - `sendPushNotificationToMultiple(userIds, title, body, data)`: Envoie à plusieurs utilisateurs
- **Fonctionnalités**:
  - Vérifie si le token est valide (Expo Push Token)
  - Gère les erreurs automatiquement
  - Supprime les tokens invalides de la base de données
  - Supporte User et Workshop

### 5. Route pour Sauvegarder le Token Push
- **Fichier**: `Router/user.ts`
- **Route**: `POST /api/user/push-token`
- **Authentification**: Requise (authenticateToken)
- **Body**:
  ```json
  {
    "pushToken": "ExponentPushToken[...]",
    "platform": "ios" | "android",
    "deviceId": "device-id"
  }
  ```
- **Réponse**: `{ ok: true, message: "Token push sauvegardé avec succès" }`

### 6. Intégration dans les Routes de Notification

#### A. Messages (Chat)
- **Fichier**: `Router/chat.ts`
- **Modification**: Lors de l'envoi d'un message, envoi d'une push notification au destinataire
- **Titre**: Nom de l'expéditeur
- **Corps**: Contenu du message
- **Données**: `{ notificationId, type: 'message', senderId, chatId }`

#### B. Rendez-vous Workshop
- **Fichier**: `Router/rdvWorkshop.ts`
- **Modifications**:
  1. **Création de rendez-vous**: Push notification à l'atelier
  2. **Mise à jour du statut**: Push notification à l'utilisateur (accepté, refusé, en cours, terminé)
  3. **Annulation automatique**: Push notification à l'atelier quand un rendez-vous expire

#### C. Notifications Admin
- **Fichier**: `Router/admin.ts`
- **Modification**: Push notification pour les avertissements de prix de voiture
- **Titre**: "Avertissement de prix"
- **Corps**: Message d'avertissement personnalisé ou par défaut

## 🔧 Comment Ça Fonctionne

### Flux Complet

1. **Enregistrement du Token** (Frontend → Backend):
   - L'app mobile obtient le token Expo Push via `getExpoPushTokenAsync({ projectId })`
   - L'app envoie le token au backend via `POST /api/user/push-token`
   - Le backend sauvegarde le token dans la base de données

2. **Envoi de Notification** (Backend):
   - Quand une notification est créée (message, rendez-vous, etc.)
   - Le backend appelle `sendPushNotification()` avec l'ID de l'utilisateur
   - Le service récupère le token push de l'utilisateur
   - Le service envoie la notification via Expo Push Notification Service (EPNS)
   - La notification arrive même si l'app est fermée

3. **Réception** (Mobile):
   - Expo Push Notification Service envoie la notification au device
   - Le système d'exploitation affiche la notification
   - L'utilisateur peut cliquer sur la notification pour ouvrir l'app

## 📋 Checklist de Déploiement

- [x] Installer `expo-server-sdk` dans package.json
- [x] Modifier le modèle User pour ajouter pushToken, platform, deviceId
- [x] Modifier le modèle Workshop pour ajouter pushToken, platform, deviceId
- [x] Créer le service pushNotificationService.ts
- [x] Créer la route POST /user/push-token
- [x] Intégrer les push notifications dans chat.ts
- [x] Intégrer les push notifications dans rdvWorkshop.ts
- [x] Intégrer les push notifications dans admin.ts
- [ ] Installer les dépendances: `npm install` ou `bun install`
- [ ] Redémarrer le serveur backend
- [ ] Tester les notifications dans tous les scénarios

## 🧪 Tests à Effectuer

1. **Test d'enregistrement du token**:
   - Se connecter à l'app mobile
   - Vérifier que le token est sauvegardé dans la base de données
   - Vérifier les logs du backend pour confirmer la sauvegarde

2. **Test de notification de message**:
   - Envoyer un message à un utilisateur
   - Vérifier que la notification push arrive même si l'app est fermée
   - Vérifier que la notification s'affiche correctement

3. **Test de notification de rendez-vous**:
   - Créer un rendez-vous
   - Vérifier que l'atelier reçoit la notification push
   - Changer le statut du rendez-vous
   - Vérifier que l'utilisateur reçoit la notification push

4. **Test avec l'app fermée**:
   - Fermer complètement l'app
   - Envoyer une notification depuis le backend
   - Vérifier que la notification apparaît sur l'écran de verrouillage

5. **Test avec l'app en arrière-plan**:
   - Mettre l'app en arrière-plan
   - Envoyer une notification
   - Vérifier que la notification apparaît

## ⚠️ Notes Importantes

1. **Tokens Invalides**: Le service supprime automatiquement les tokens invalides de la base de données quand Expo retourne une erreur `DeviceNotRegistered`

2. **Gestion d'Erreurs**: Toutes les erreurs sont loggées mais n'interrompent pas le flux de l'application. Si une push notification échoue, l'application continue de fonctionner normalement.

3. **Socket.IO vs Push Notifications**:
   - Socket.IO: Fonctionne uniquement quand l'app est ouverte (temps réel)
   - Push Notifications: Fonctionne même quand l'app est fermée (via EPNS)
   - Les deux sont utilisés ensemble pour une meilleure expérience utilisateur

4. **Performance**: Les push notifications sont envoyées de manière asynchrone et n'affectent pas les performances des routes API.

## 🔍 Dépannage

### Les notifications ne fonctionnent pas
1. Vérifier que `expo-server-sdk` est installé: `npm list expo-server-sdk`
2. Vérifier que le token est sauvegardé dans la base de données
3. Vérifier les logs du backend pour les erreurs
4. Vérifier que le projectId dans le frontend correspond à celui dans app.json

### Erreur "DeviceNotRegistered"
- Le token est invalide ou expiré
- Le service supprime automatiquement le token
- L'utilisateur doit se reconnecter pour obtenir un nouveau token

### Les notifications arrivent mais l'app ne s'ouvre pas
- Vérifier que les données dans la notification sont correctes
- Vérifier la configuration de navigation dans l'app mobile

## 📚 Documentation

- Expo Push Notifications: https://docs.expo.dev/push-notifications/overview/
- Expo Server SDK: https://github.com/expo/expo-server-sdk-node
