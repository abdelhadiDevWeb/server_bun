# Configuration Email - Gmail Setup

Pour activer l'envoi d'emails de vérification, vous devez configurer un mot de passe d'application Gmail.

## Étapes pour obtenir un App Password Gmail

1. **Activez la validation en 2 étapes** sur votre compte Google :
   - Allez sur https://myaccount.google.com/security
   - Activez "Validation en deux étapes" si ce n'est pas déjà fait

2. **Générez un mot de passe d'application** :
   - Allez sur https://myaccount.google.com/apppasswords
   - Sélectionnez "Mail" comme application
   - Sélectionnez "Autre (nom personnalisé)" comme appareil
   - Entrez "CarSure DZ Server" comme nom
   - Cliquez sur "Générer"
   - **Copiez le mot de passe généré** (16 caractères sans espaces)

3. **Ajoutez-le dans votre `.env`** :
   ```env
   SMTP_USER=hadiabdou721@gmail.com
   SMTP_PASSWORD=votre_mot_de_passe_application_ici
   ```
   
   Note: Le service supporte aussi `EMAIL` et `EMAIL_PASSWORD` pour compatibilité, mais `SMTP_USER` et `SMTP_PASSWORD` sont recommandés.

4. **Redémarrez le serveur Bun** pour que les changements prennent effet.

## Test

Après configuration, testez l'inscription. Si l'email fonctionne, vous verrez :
```
✅ Verification email sent to: user@example.com
```

Si l'email échoue, vous verrez :
```
❌ Error sending email: [erreur]
⚠️  Verification code (for testing): 123456
```

Le code de vérification sera affiché dans les logs en mode développement pour faciliter les tests.
