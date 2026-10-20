# Petite Bibliothèque

自分専用の本棚サイトです。スマホでもPCでも使えます。

- **Shelf**：背表紙が並ぶ本棚。背表紙をタップすると、その本の背景の上に表紙と情報が出ます
- **List**：表紙つきの一覧
- **Add a book**：バーコード読み取り／題名・作者で検索／自分で入力 の3通りで追加
- **Menu**：本の検索、本の管理（情報の修正・背景・表紙や背表紙の写真・削除）、タグ・本棚・背景画像の管理

本の情報と表紙は **楽天ブックス書籍検索API** で探し、見つからないときは **Google Books API** で探します。
背表紙は表紙の色から自動で作られ、持っている本は背表紙の写真に差し替えられます。

---

## しくみ

| 部分 | 使っているもの | 費用 |
|---|---|---|
| 画面（このフォルダ） | HTML / CSS / JavaScript（ビルド不要） | 無料 |
| 公開 | GitHub Pages（`https://myuutan.github.io/Bookshelf/`） | 無料 |
| データと画像の保存・ログイン | Supabase（データベース・Storage・メールでのログイン） | 無料枠で十分 |
| 本の情報を探すサーバー関数 | Supabase Edge Functions（`supabase/functions/book-lookup`） | 無料枠で十分 |

楽天の **accessKey** は秘密の鍵なので、ブラウザ側（`config.js`）には書かず、サーバー関数の中だけで使います。

```
Bookshelf/
├── index.html
├── assets/
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js       画面と操作
│   │   ├── store.js     データの保存（Supabase／お試しモード）
│   │   ├── scanner.js   バーコード読み取り
│   │   ├── util.js      題名の切れ目・画像・色・ISBN の処理
│   │   └── config.js    Supabase の接続情報（ここだけ書き換える）
│   └── backdrops/       最初から入っている背景写真
└── supabase/
    ├── migrations/20261020000000_init.sql   データベースの設定
    └── functions/book-lookup/index.ts       楽天→Google Books で本を探す関数
```

---

## 0. まずはお試しモードで動かしてみる（設定なし）

`config.js` が空のあいだは **お試しモード** で動きます。データはそのブラウザの中だけに保存され、見本の本が入っています。
本の検索は Google Books だけ使います（楽天はサーバー関数が必要なため）。

```bash
cd ~/dev/private/Bookshelf
python3 -m http.server 8000
```

ブラウザで <http://localhost:8000> を開きます。
（`index.html` をダブルクリックで開くと動きません。必ず上のようにサーバー経由で開いてください）

> バーコード読み取りはカメラを使うので、`https://` の公開ページ（手順1のあと）か `localhost` でだけ動きます。

---

## 1. GitHub Pages で公開する

1. GitHub で新しいリポジトリ `Bookshelf` を作る
   - 無料プランで GitHub Pages を使うには **Public** にする必要があります。コードと `assets/backdrops` の写真は誰でも見られる状態になります（本のデータは Supabase 側にあり、本人しか見られません）
2. このフォルダを push する
   ```bash
   cd ~/dev/private/Bookshelf
   git init
   git add .
   git commit -m "Petite Bibliothèque"
   git branch -M main
   git remote add origin https://github.com/myuutan/Bookshelf.git
   git push -u origin main
   ```
3. GitHub のリポジトリ画面 → **Settings → Pages** → Source を「Deploy from a branch」、Branch を `main` / `/(root)` にして保存
4. 数分後に `https://myuutan.github.io/Bookshelf/` で開けます

---

## 2. Supabase を準備する（データの保存とログイン）

1. <https://supabase.com> でアカウントを作り、**New project** を作成（リージョンは Tokyo がおすすめ）
2. 左メニューの **SQL Editor** を開き、`supabase/migrations/20261020000000_init.sql` の中身を全部貼り付けて **Run**
3. **Authentication** で自分のユーザーを作る
   - Users → **Add user**（または Invite）で自分のメールアドレスを登録
   - 他の人が登録できないように、サインアップ（新規登録）を許可する設定を **オフ** にする
4. **Authentication → URL Configuration**
   - Site URL：`https://myuutan.github.io/Bookshelf/`
   - Redirect URLs に `https://myuutan.github.io/Bookshelf/` と `http://localhost:8000/` を追加
5. **Project Settings → API**（または API Keys）で次の2つをコピーし、`assets/js/config.js` に貼る
   - Project URL → `SUPABASE_URL`
   - anon / publishable key → `SUPABASE_ANON_KEY`
   - ※ **service_role / secret key は絶対に貼らないでください**

`config.js` を保存して開き直すと、ログイン画面になります。メールアドレスを入れると、ログイン用のリンクがメールで届きます。
はじめてログインしたときに、タグ・本棚・背景写真と、最初の1冊（『犬は生まれながらにして哲学者である』）が自動で入ります。

---

## 3. 楽天ブックスAPIの準備

1. Rakuten Developers（<https://webservice.rakuten.co.jp/>）に楽天IDでログイン
2. 新しいアプリを登録し、**アプリID（applicationId）** と **アクセスキー（accessKey）** を控える
3. アプリの設定で、使うサイトのドメインとして `myuutan.github.io` を登録する
   （楽天のAPIは、登録したサイトからの呼び出しかどうかを確認しています）

楽天のAPIを使うページには、楽天のクレジット表記が必要です。ページの一番下に「Supported by Rakuten Developers」を入れてあります。

---

## 4. 本を探すサーバー関数を公開する

Mac のターミナルで実行します。

```bash
# Supabase CLI を入れる（初回だけ）
brew install supabase/tap/supabase

cd ~/dev/private/Bookshelf
supabase login
supabase link --project-ref <プロジェクトID>     # ダッシュボードのURLにある英数字

# 秘密の鍵を登録（ここに書いた値は GitHub には上がりません）
supabase secrets set RAKUTEN_APP_ID=<アプリID> RAKUTEN_ACCESS_KEY=<アクセスキー> SITE_ORIGIN=https://myuutan.github.io
# （任意）Google Books の APIキーがあれば
# supabase secrets set GOOGLE_BOOKS_KEY=<キー>

supabase functions deploy book-lookup
```

これで「Add a book」のバーコード・ISBN・題名検索が、楽天ブックス → Google Books の順に本を探すようになります。

---

## よくある困りごと

- **ログインのメールが届かない**：迷惑メールフォルダを確認。Supabase の無料のメール送信は1時間あたりの回数に制限があります
- **「このメールアドレスは登録されていません」**：手順2-3でユーザーを作ったか確認
- **本が見つからない**：ISBN を数字で入れて試す。新しすぎる本や同人誌は載っていないことがあります。「自分で入力」からいつでも追加できます
- **表紙が出ない**：楽天にも Google にも表紙がない本です。Menu → Books → その本 →「表紙を変える」で自分で撮った写真を入れられます
- **カメラが起動しない**：ブラウザでカメラを許可しているか、`https://` のページで開いているか確認

## 今後の候補

- 読み終えた日や感想のメモ
- 本棚の並べ替え（ドラッグ）
- ホーム画面に追加したときのアプリ化（PWA）
