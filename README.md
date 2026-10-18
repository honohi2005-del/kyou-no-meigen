# 今日の名言

日本語学習者向けの名言音読アプリです。日本でよく知られている短い名言を、ルビ・出典・読み上げ音声付きで表示します。

## できること

- 100件の名言から、東京の日付を基準に今日の一件を表示
- 漢字にルビを付けて表示
- 出典と人物・作品名を確認
- Google Cloud Text-to-Speechで事前生成した男性音声のMP3を再生
- 学習者の音読をブラウザ内に保存・再生・削除
- キーワードで名言を検索し、特定の名言を開く

録音データはサーバーへ送信せず、利用したブラウザのIndexedDBにだけ保存します。ブラウザのデータを削除すると録音も消えます。

## ローカルで確認

~~~powershell
npx.cmd serve .
~~~

file: URLでは音声・JSON・Service Workerの動作確認が制限されるため、ローカルサーバー経由で開いてください。

## 音声生成

音声ファイルは audio/ に置き、GitHub Pagesから静的配信します。既定の音声はGoogle Cloud Text-to-Speechの日本語男性音声 `ja-JP-Standard-C` です。生成スクリプトは、まず GOOGLE_TTS_API_KEY または GOOGLE_API_KEY を使い、利用できない場合は gcloud のOAuthアクセストークンへフォールバックします。女性音声を指定した生成は検査で受け付けません。

~~~powershell
gcloud auth login
$env:GOOGLE_TTS_QUOTA_PROJECT = (gcloud config get-value project)
npm.cmd run generate:audio
npm.cmd run check
~~~

APIキーやアクセストークンはリポジトリに保存しません。Google Cloud Text-to-Speechの仕様は[公式RESTリファレンス](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize)を参照してください。

## GitHub Pages

main ブランチへのpushで .github/workflows/deploy-pages.yml がGitHub Pagesへデプロイします。リポジトリ設定のPagesでは、ビルド方法としてGitHub Actionsを選択してください。

## 名言データについて

名言は公開資料を照合して整理しています。伝承・異説・後世の要約があるものは、出典欄で「〜とされる」などの注記を付けています。参考資料として、[日本人なら知っておきたい名言100](https://www.horei.com/book_978-4-86280-425-9.html)、[名言図鑑](https://meigen-zukan.com/)、[青空文庫](https://www.aozora.gr.jp/)を確認しました。

## 検査

~~~powershell
npm.cmd run check:data
npm.cmd run check
~~~
