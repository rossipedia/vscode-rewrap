import * as vscode from 'vscode'
import { 
  ExtensionContext, Range, Selection, TextDocument, TextEditor, TextEditorEdit,
  commands, workspace,
} from 'vscode'
require('./extensions')

import DocumentProcessor, { Edit, WrappingOptions } from './DocumentProcessor'
import BasicLanguage from './BasicLanguage'
import { fromDocument } from './DocumentTypes'
import { adjustSelections } from './FixSelections'
import Section from './Section'


export { activate, getEditsAndSelections, wrapSomething }


/** Is called when the extension is activated, the very first time the
 *  command is executed */
function activate(context: ExtensionContext) 
{
  context.subscriptions.push(
    commands.registerTextEditorCommand(
      'rewrap.rewrapComment', 
      editor => {
        // Tried doing this as wrapSomething().then(undefined, errback) but it
        // didn't catch errors.
        try {
          const options = getOptionsFromEnvironment(editor)
          return wrapSomething(editor, options)
        }
        catch (err) {
          console.error("Rewrap: Something happened.")
          console.log(err)
          console.error(
            "Rewrap: Please report this (with a screenshot of this log) at " +
            "https://github.com/stkb/vscode-rewrap/issues"
          )       
          vscode.window.showInformationMessage(
            "Sorry, there was an error in Rewrap. " +
            "Go to: Help -> Toggle Developer Tools -> Console " +
            "for more information."
          )
          return null
        }
      }
    )
  )
}


/** Finds the processor for the document and does the wrapping */
async function wrapSomething
  ( editor: TextEditorLike, options: WrappingOptions
  )
{
  const documentProcessor = fromDocument(editor.document)
      , documentLines = 
          Array.range(0, editor.document.lineCount)
            .map(i => editor.document.lineAt(i).text)

  const [edits, newSelections] = 
          getEditsAndSelections
            ( documentProcessor, documentLines, editor.selections, options
            )
  
  await editor.edit(eb => applyEdits(edits, editor.document, eb))

  editor.selections = newSelections
}


function applyEdits(edits: Edit[], document: TextDocument, builder: TextEditorEdit)
{
  edits.forEach(e => {
    const range = 
            document.validateRange(
              new Range(e.startLine, 0, e.endLine, Number.MAX_VALUE)
            )
        , text = e.lines.join('\n')
    builder.replace(range, text)
  })
}


/** Gets the edits to be made to a document and the positions the selections
 *  should be in afterwards. */
function getEditsAndSelections
  ( documentProcessor: DocumentProcessor
  , documentLines: string[]
  , selections: Selection[]
  , options: WrappingOptions
  ) : [ Edit[], Selection[] ]
{
  const sections = 
          documentProcessor.findSections(documentLines, options.tabSize)  
      , sectionsToEdit = 
          Section.sectionsInSelections
            ( sections.primary, sections.secondary, selections
            )

  // Edits should be kept in ascending order, for `adjustSelections`. For
  // applying the edits with `editor.edit` it doesn't matter.
  const edits = 
          sectionsToEdit
            .map(sectionToEdit => 
                  documentProcessor.editSection(options, sectionToEdit))

  // Get the adjusted selections to apply after the edits are done
  const adjustedSelections = 
          adjustSelections(documentLines, selections, edits)


  return [ edits, adjustedSelections ]
}


/** Defines a TextEditor with the minimum set of features needed to do wrapping
 *  on a document. Used for tests. */
export interface TextEditorLike {
  document: vscode.TextDocument
  edit(callback: (editBuilder: TextEditorEdit) => void): Thenable<boolean>
  options: vscode.TextEditorOptions
  selections: vscode.Selection[]
}


function getOptionsFromEnvironment
  ( editor: TextEditorLike
  ) : WrappingOptions 
{
  const wrappingColumn = getWrappingColumn()
      , tabSize = getTabSize(editor, wrappingColumn)
      , doubleSentenceSpacing = 
          workspace.getConfiguration('rewrap').get<boolean>('doubleSentenceSpacing')
  return { wrappingColumn, tabSize, doubleSentenceSpacing }
}


/** Gets the tab size from the editor, according to the user's settings.
 *  Sanitizes the input. */
function getTabSize(editor: TextEditorLike, wrappingColumn: number): number 
{
  let tabSize = editor.options.tabSize as number
  
  if(!Number.isInteger(tabSize) || tabSize < 1) {
    console.warn(
      "Rewrap: tabSize is an invalid value (%o). " +
      "Using the default of (4) instead.", tabSize
    )
    tabSize = 4
  }
  
  if(tabSize > wrappingColumn / 2) {
    console.warn(
      "Rewrap: tabSize is (%d) and wrappingColumn is (%d). " +
      "Unexpected results may occur.", tabSize, wrappingColumn
    )
  }

  return tabSize
}


/** Gets the wrapping column (eg 80) from the user's settings.  
 *  Sanitizes the input. */
function getWrappingColumn(): number {
  const extensionColumn =
          workspace.getConfiguration('rewrap').get<number>('wrappingColumn')
      , rulers =
          workspace.getConfiguration('editor').get<number[]>('rulers')
      , editorColumn =
          workspace.getConfiguration('editor').get<number>('wrappingColumn')

  let wrappingColumn =
        extensionColumn
        || rulers[0]
        // 300 is the default for 'editor.wrappingColumn' so we check it's not
        // that. If that default changes in vscode this will break.
        || (0 < editorColumn && editorColumn < 300) && editorColumn
        || 80
  
  if(!Number.isInteger(wrappingColumn) || wrappingColumn < 1) {
    console.warn(
      "Rewrap: wrapping column is an invalid value (%o). " +
      "Using the default of (80) instead.", wrappingColumn
    )
    wrappingColumn = 80
  }
  else if(wrappingColumn > 120) {
    console.warn(
      "Rewrap: wrapping column is a rather large value (%d).", wrappingColumn
    )
  }

  return wrappingColumn
}