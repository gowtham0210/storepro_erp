/** Where an exported file goes: the person chooses, so the main process asks them (M22-03). */
export interface FileSaver {
  /**
   * Ask where to save `content` as a file, suggesting `suggestedName`, and write it.
   * Returns the name the file was saved under, or null if the person cancelled.
   */
  saveText(suggestedName: string, content: string): Promise<{ fileName: string } | null>
}
