import { app, BrowserWindow, ipcMain } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer'
import { enableLiveReload } from 'electron-compile'
import fs from 'fs'
import parse from 'csv-parse'
import pdfjsLib from 'pdfjs-dist'
import pdftk from 'node-pdftk'
import Canvas from 'canvas'
import assert from 'assert'

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

// Keep the actual CSV data with the main process, as global state.
// It will be updated on receiving a 'load-csv' event.
let csvRows = [];

const isDevMode = process.execPath.match(/[\\/]electron/);

if (isDevMode) enableLiveReload({ strategy: 'react-hmr' });

const createWindow = async () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
  });

  // and load the index.html of the app.
  mainWindow.loadURL(`file://${__dirname}/index.html`);

  // Open the DevTools.
  if (isDevMode) {
    await installExtension(REACT_DEVELOPER_TOOLS);
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});

function replaceOutputPathTokens(outputPathTemplate, outputPathReplacements, row) {
  const replacementStringPairs = {}

  for (const replacedString in outputPathReplacements) {
    replacementStringPairs[replacedString] =
        outputPathReplacements[replacedString].reduce((replacementString, mapping) => {
          if (mapping.source === 'table' && mapping.columnIndex < row.length) {
            return replacementString + row[mapping.columnIndex]
          }
          else if (mapping.source === 'text') {
            return replacementString + mapping.text
          }
          return replacementString
        }, '')
  }

  let outputPath = outputPathTemplate

  for (const replaced in replacementStringPairs) {
    outputPath = outputPath.replace(replaced, replacementStringPairs[replaced])
  }
}

ipcMain.on('generate-pdfs', (event, pdfTemplatePath, pdfOutputPathTemplate, fieldMappings) => {
  /* e.g.
    fieldMappings = [
      {
        fieldName: 'TR_NUMBER',
        mapping: {
          source: 'table',
          columnIndex: 2,
        }
      },
      {
        fieldName: 'PROVINCE',
        mapping: {
          source: 'text',
          text: 'ON',
        }
      }
    ];
  */

  console.log('PDF: ' + pdfTemplatePath)
  console.log('Path template: ' + pdfOutputPathTemplate)

  const pdfOutputPathReplacements = {}
  {
    const pdfFieldNameRegex = /{@\S+}/g
    const csvColumnIndexRegex = /{#[0-9]+}/g

    const fieldNameReplacements = fieldMappings.reduce((replacements, mapping) => {
      replacements['{@' + mapping.fieldName + '}'] = [ mapping.mapping ]
      return replacements
    })

    for (const match of (pdfOutputPathTemplate.match(pdfFieldNameRegex) || [])) {
      if (fieldNameReplacements[match] !== undefined) {
        pdfOutputPathReplacements[match] = fieldNameReplacements[match]
      }
    }

    for (const match of (pdfOutputPathTemplate.match(csvColumnIndexRegex) || [])) {
      pdfOutputPathReplacements[match] = [ {
        source: 'table',
        columnIndex: parseInt(match.substr(2, match.length - 1)) // exclude '{#' and '}'
      } ]
    }
  }

  const generatedPdfs = []
  const errors = []
  const skipRows = 1
  let rowIndex = 0

  for (const row of csvRows) {
    if (rowIndex < skipRows) {
      continue
    }

    const mappings = fieldMappings.reduce((filledFormFields, fieldMapping) => {
      if (fieldMapping.mapping.source == 'table'
          && fieldMapping.mapping.columnIndex < row.length)
      {
        filledFormFields[fieldMapping.fieldName] = row[fieldMapping.mapping.columnIndex]
      }
      else if (fieldMapping.mapping.source == 'text') {
        filledFormFields[fieldMapping.fieldName] = fieldMapping.mapping.text
      }
      return filledFormFields
    }, {})

    const pdfOutputPath = replaceOutputPathTokens(
        pdfOutputPathTemplate, pdfOutputPathReplacements, row)

    console.log('Would store PDF for row #' + rowIndex + ' as ' + pdfOutputPath + '.')

    /*pdftk.input(pdfTemplatePath)
        .fillForm(filledFormFields)
        .flatten()
        .output()
        .then(buffer => {
          fs.writeFile(pdfOutputPath, buffer, function (err) {
            if (err) {
              throw err
            }
            generatedPdfs.push({
              pdfOutputPath: pdfOutputPath,
              rowIndex: rowIndex
            })
            console.log('Stored PDF for row #' + rowIndex + ' as ' + pdfOutputPath + '.')
          })
        })
        .catch(err => {
          errors.push({
            pdfOutputPath: pdfOutputPath,
            type: 'Exception',
            name: err.name,
            message: err.message,
            rowIndex: rowIndex,
            row: row
          })
        });*/

    ++rowIndex
  }

  event.sender.send('pdf-generation-finished', generatedPdfs, errors)
})

ipcMain.on('load-pdf-template', (event, pdfTemplatePath) => {
  console.log('Loading PDF template: ' + pdfTemplatePath)

  const rawData = new Uint8Array(fs.readFileSync(pdfTemplatePath));
  const loadingTask = pdfjsLib.getDocument(rawData);

  function NodeCanvasFactory() {}
  NodeCanvasFactory.prototype = {
    create: function NodeCanvasFactory_create(width, height) {
      assert(width > 0 && height > 0, 'Invalid canvas size');
      const canvas = Canvas.createCanvas(width, height);
      const context = canvas.getContext('2d');
      return {
        canvas: canvas,
        context: context,
      };
    },

    reset: function NodeCanvasFactory_reset(canvasAndContext, width, height) {
      assert(canvasAndContext.canvas, 'Canvas is not specified');
      assert(width > 0 && height > 0, 'Invalid canvas size');
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },

    destroy: function NodeCanvasFactory_destroy(canvasAndContext) {
      assert(canvasAndContext.canvas, 'Canvas is not specified');

      // Zeroing the width and height cause Firefox to release graphics
      // resources immediately, which can greatly reduce memory consumption.
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    },
  };

  loadingTask.promise.then(function(pdfDocument) {
    console.log('# PDF document loaded.');

    const pagePromises = []
    const annotationPromises = []
    const fieldsByName = {}
    const fieldNames = []

    for (let i = 1; i <= pdfDocument.numPages; i++) {
      pagePromises.push(pdfDocument.getPage(i).then(page => {
        annotationPromises.push(page.getAnnotations().then(annotations => {
          for (const ann of annotations) {
            if (ann.subtype != 'Widget' || ann.readOnly) {
              continue
            }
            if (fieldsByName[ann.fieldName] !== undefined) {
              continue
            }
            if (ann.fieldType == 'Tx') {
              fieldsByName[ann.fieldName] = {
                fieldName: ann.fieldName,
                fieldType: 'Text',
                fieldValue: ann.fieldValue,
                multiLine: ann.multiLine,
                maxLength: ann.maxLen,
              }
              fieldNames.push(ann.fieldName)
            }
          }
        }))

        // Render the page on a Node canvas with 100% scale.
        const viewport = page.getViewport(1.0)
        const canvasFactory = new NodeCanvasFactory()
        const canvasAndContext =
            canvasFactory.create(viewport.width, viewport.height)
        const renderContext = {
          canvasContext: canvasAndContext.context,
          viewport: viewport,
          canvasFactory: canvasFactory,
        }

        const renderTask = page.render(renderContext)
        renderTask.promise.then(() => {
          // Convert the canvas to an image buffer.
          const image = canvasAndContext.canvas.toDataURL('image/png')
          event.sender.send('pdf-preview-updated', pdfTemplatePath, image)
        })
      }))
    }
    Promise.all(pagePromises).then(() => {
      Promise.all(annotationPromises).then(() => {
        event.sender.send('pdf-fields-available', pdfTemplatePath,
            fieldNames.reduce((fields, fieldName) => {
              fields.push(fieldsByName[fieldName])
              return fields
            }, []))
      })
    })
  }).catch(function(reason) {
    console.log(reason);
  })
})

ipcMain.on('load-csv', (event, csvPath) => {
  let context = this
  let rows = []
  let filestream = fs.createReadStream(csvPath)
    .pipe(parse())
    .on('data', function(row) {
      rows.push(row)
    })
    .on('error', function(err) {
      dialog.showErrorBox("CSV loading error", err.message);
    })
    .on('end', function() {
      const fields = rows[0].map((field, index) => ({
        fieldIndex: index,
        fieldName: field
      }))
      csvRows = rows;
      event.sender.send('csv-fields-available', csvPath, fields)
    })
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.