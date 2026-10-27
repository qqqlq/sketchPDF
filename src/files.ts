/** ファイル選択ダイアログを開く(ユーザー操作の中で呼ぶこと)。キャンセル時は空配列 */
export function pickFiles(accept: string, multiple = false) {
  return new Promise<File[]>(resolve => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept; input.multiple = multiple
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

export const pickPdf = () => pickFiles('application/pdf').then(f => f[0])
export const pickPdfs = () => pickFiles('application/pdf', true)
export const pickImage = () => pickFiles('image/*').then(f => f[0])
