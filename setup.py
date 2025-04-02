#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from setuptools import setup

APP = ['main.py']
DATA_FILES = []
OPTIONS = {
    'argv_emulation': True,
    'iconfile': 'mascopy.icns',
    'packages': ['PyQt6', 'ui', 'Pillow', 'pymediainfo'],
    'plist': {
        'CFBundleName': 'MasCopy',
        'CFBundleDisplayName': 'MasCopy',
        'CFBundleIdentifier': 'com.yourname.mascopy',
        'CFBundleVersion': '1.0.0',
        'CFBundleShortVersionString': '1.0.0',
        'NSHumanReadableCopyright': '© 2024',
    }
}

setup(
    app=APP,
    data_files=DATA_FILES,
    options={'py2app': OPTIONS},
    setup_requires=['py2app'],
) 