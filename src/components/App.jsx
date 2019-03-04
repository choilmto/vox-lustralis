import React from 'react'
import { remote, ipcRenderer } from 'electron'
import path from 'path'
import VLHeader from './VLHeader'
import VLButton from './VLButton'
import VLAvailableFields from './VLAvailableFields'

const { dialog } = remote
const EMPTY = "<empty>"
const TABLE = "table"
const TEXT = "text"
const WIDTH_OF_COLUMN = '15em'

export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.onLoadCSVFile = this.onLoadCSVFile.bind(this)
    this.onLoadPDFFile = this.onLoadPDFFile.bind(this)
    this.resetFieldMappings = this.resetFieldMappings.bind(this)
    this.onFieldMappingChange = this.onFieldMappingChange.bind(this)
    this.state = {
      pdfFields: [],
      csvFields: [],
      previewSrc: '',
      pdfTemplatePath: '',
      fieldMappings: []
    }

    ipcRenderer.on('pdf-fields-available', (event, pdfTemplatePath, fields) => {
      console.log(fields)
      const updates = this.resetFieldMappings(this.state.csvFields, fields)
      updates.pdfTemplatePath = pdfTemplatePath
      this.setState(updates)
    })

    ipcRenderer.on('csv-fields-available', (event, csvPath, fields) => {
      this.setState(this.resetFieldMappings(fields, this.state.pdfFields))
    })

    ipcRenderer.on('pdf-preview-updated', (event, pdfTemplatePath, imgsrc) => {
      this.setState({ previewSrc: imgsrc })
    })
  }

  resetFieldMappings(csvFields, pdfFields) {
    return {
      pdfFields: pdfFields,
      csvFields: csvFields,
      fieldMappings: []
    }
  }

  onFieldMappingChange(csvFieldValue, pdfFieldName, mappingSource) {
    this.setState(previousState => {
      let fieldMappings = [...previousState.fieldMappings]
      let index = fieldMappings.findIndex(element =>
        element.fieldName === pdfFieldName)
      index = (index === -1) ? fieldMappings.length : index
      fieldMappings.splice(index, 1)

      const newEntry = csvFieldValue === EMPTY ? [] :
        [{
          fieldName: pdfFieldName,
          mapping: mappingSource === TABLE
            ? {
                source: 'table',
                columnIndex: parseInt(csvFieldValue)
              }
            : {
                source: 'text',
                text: csvFieldValue,
              }
        }]

      return { fieldMappings: [...fieldMappings, ...newEntry] }
    })
  }

  onLoadPDFFile() {
    const filenames = dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'PDF files', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!Array.isArray(filenames) || filenames.length !== 1) {
      return
    }

    const canvas = document.getElementById('pdf-preview');
    ipcRenderer.send('load-pdf-template', filenames[0])
  }

  onLoadCSVFile() {
    const filenames = dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'CSV files', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!Array.isArray(filenames) || filenames.length !== 1) {
      return
    }

    ipcRenderer.send('load-csv', filenames[0])
  }

  onGeneratePDFs() {
    const dirnames = dialog.showOpenDialog({properties: ['openDirectory']})
    if (!Array.isArray(dirnames) || dirnames.length !== 1) {
      return
    }

    ipcRenderer.send('generate-pdfs', this.state.pdfTemplatePath,
        dirnames[0] + path.sep + 'Tax Receipt {@TR_NUMBER} - {@NAME}.pdf',
        this.state.fieldMappings)
  }

  render() {
    const appStyle = {
      display: 'grid',
      gridTemplateColumns: `${WIDTH_OF_COLUMN} ${WIDTH_OF_COLUMN} 1fr`,
      gridTemplateRows: '1fr 9fr',
      height: '10em'
    }

    return (<div>
      <VLHeader/>
      <div style={appStyle}>
        <VLButton
          value={"Load PDF template"}
          onClick={this.onLoadPDFFile}
          disabledButton={false}/>
        <VLButton
          value={"Load CSV table"}
          onClick={this.onLoadCSVFile}
          disabledButton={this.state.pdfFields.length === 0}/>
        <VLButton
          value={"Select output folder"}
          onClick={this.onGeneratePDFs.bind(this)}
          disabledButton={this.state.pdfTemplatePath === '' || this.state.csvFields.length === 0}/>

        <VLAvailableFields
          csvFields={this.state.csvFields}
          pdfFields={this.state.pdfFields}
          onFieldMappingChange={this.onFieldMappingChange}
          width={WIDTH_OF_COLUMN}
          empty={EMPTY}
          table={TABLE}
        />

        <div>
          {this.state.previewSrc ?
            <img id="pdf-preview" src={this.state.previewSrc}/> :
            <div style={{fontSize: '10em'}}>3</div>
          }
        </div>
      </div>
    </div>);
  }
}