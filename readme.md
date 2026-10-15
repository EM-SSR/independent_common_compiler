# Commoncとかいうコンパイラ

cmn形式のファイルをbinにコンパイルしたり、binをvcpu上で実行できるよ！(文法について天才的にもこんなわずかな例から理解できたなら)cmnを書き換えれば色々書けるはず。そのうちドキュメントも書きます...

## 実行例

### .cmnのコンパイル

"""
python independent_compile_test/vcpu.py independent_compile_test/commonc_lane64.bin --words 500000 --in independent_compile_test/examples/cmn/futatsu.cmn --in-base 393216 --emit independent_compile_test/examples/cmn/futatsu.bin
"""

commonc_lane64.bin が lane64 つまりvCPUで実行可能なコンパイラのbin。.cmnのセルフホストについては (できるはずだけど) まだやっていない。

### cmnからビルドしたbinの実行

"""
python independent_compile_test/vcpu.py independent_compile_test/commonc_lane64.bin --words 300000 --dump 32
"""

出てくるw[0]からw[31]までの語の値が、要はメモリの値みたいなもので、--words の値のぶん語が割り当てられ、--bump の値ぶん語の値をターミナルに出力できる。 --wordはそれなりに使うのでできるだけ大きな値を与えた方が良い。

### .camからのコンパイル

"""
independent_compile_test\bin\common.exe independent_compile_test\common_lang\commonc\src\commonc_lane64.cam -o independent_compile_test\dist\commonc\commonc_lane64 -t lane64
"""

independent_compile_test\dist\commonc\commonc_lane64にビルドされるはず。
- independent_compile_test\dist\commoncまで空ファイルがないとNo Such Directoryになるので、作っておく。
- .binが付いていないけど付けてもいいし付けなくても機能はするはず。
- ちょっときしょいのでこれらの不具合については将来直す...

### common.exe (.cam用のコンパイラ) のHaskellからのビルド

"""
independent_compile_test/Build.ps1
"""
Haskellのインストールとかは調べれば実行できるはず。あるいは単にChatGPTやClaude Codeとかに訊けば一発！