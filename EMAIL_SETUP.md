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

3. **Ajoutez-le dans votre `.env`** (exemple Gmail) :
   ```env
   EMAIL_PROVIDER=smtp
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=votre_compte@gmail.com
   SMTP_PASSWORD=abcdefghijklmnop
   ```
   - Utilisez **exactement** le mot de passe d’application (16 lettres). Vous pouvez le coller **avec ou sans espaces** ; le serveur les retire automatiquement.
   - **Ne pas** utiliser le mot de passe du compte Google normal (erreur **535 Incorrect authentication data**).
   - Alias supportés : `EMAIL` / `EMAIL_PASSWORD`, `SMTP_PASS`, `GMAIL_APP_PASSWORD`.
   - Avec Gmail, l’adresse dans **`SMTP_FROM`** (si vous la définissez) doit en général être la même que **`SMTP_USER`**.

4. **Redémarrez le serveur Bun** pour que les changements prennent effet.

## Erreur `535 Incorrect authentication data`

Côté Google / la plupart des SMTP, cela signifie **identifiants refusés** :

1. Vérifiez **2FA** + **mot de passe d’application** (pas le mot de passe web).
2. Vérifiez **`SMTP_HOST` / `SMTP_PORT`** : Gmail = `smtp.gmail.com` et `587` avec `SMTP_SECURE=false` (ou port `465` avec `SMTP_SECURE=true`).
3. Regénérez un nouveau mot de passe d’application si besoin.
4. En hébergement (Render, VPS), vérifiez que les variables d’environnement sont bien déployées **sans** guillemets en trop autour du secret.

## Mot de passe avec `#`, `&`, guillemets

Dans un fichier `.env`, **`#` commence souvent un commentaire** : tout ce qui suit peut être ignoré, ce qui tronque le mot de passe et provoque **535**.

- Préférez : `SMTP_PASSWORD='(votre_mot_de_passe_avec#caractères)'` (guillemets simples, **sans** espaces autour du `=`).
- Ou utilisez le base64 UTF-8 du mot de passe : `SMTP_PASSWORD_B64=KHV0Zi04...` (voir logs avec `DEBUG_SMTP=true` pour vérifier la longueur chargée).

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
